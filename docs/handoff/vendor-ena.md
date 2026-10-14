# Handoff: vendor-ena (wave 13, M3; vendor ena 0.14.4 + rustc_data_structures snapshot_map / sso)

Branch `lane/vendor-ena`, based on 2e11981. No merges.

**ena 0.14.4** (the version in upstream's Cargo.lock) is vendored in full: every fn of the published
package is covered, including the crate's unit tests and the integration test `tests/external_undo_log.rs`.
ena 0.14.4 has no `snapshot_map` or `sso`. Those are rustc_data_structures modules
(`snapshot_map/mod.rs`, `sso/{mod,map,set}.rs`), and plan-m3 §5 assigns them to this lane, so they are
ported at their mirrored paths.

## Files (all new)
- `src/vendor/ena/lib.ts`: lib.rs (`export * as snapshot_vec / undo_log / unify`), plus the
  `crate-skip`s for `src/bitvec.rs`. That file ships in the package, but lib.rs declares no `mod bitvec`, so it is never compiled.
- `src/vendor/ena/undo_log.ts`:
  - `UndoLogs<T>` and `Snapshots<T, S>` (interfaces), with `UndoLogs_provided` / `Snapshots_provided`;
  - `NoUndo`, `VecLog<T>` (+ `debug_VecLog`), `Rollback<U>`, `Snapshot`.
- `src/vendor/ena/snapshot_vec.ts`:
  - `UndoLog<Value, Undo>` (+ `debug_UndoLog`, `clone_UndoLog`) and `reverse_Vec` (the `Rollback` impl for `Vec`);
  - `VecLike` / `VecLike_Vec`, `SnapshotVecDelegate<Value, Undo>`, `SnapshotVecDelegate_i32`;
  - `SnapshotVec<Value, Undo, L>` (+ `debug_SnapshotVec`), `SnapshotVecStorage`, `Snapshot<S>`.
- `src/vendor/ena/unify/mod.ts`:
  - `UnifyKey<K, V, E>` + `UnifyKey_provided`, `UnifyValue<V, E>`, `EqUnifyValue<T>` + `UnifyValue_EqUnifyValue`;
  - `NoError` (+ `debug_NoError`), `VarValue<K, V>` (+ `debug_VarValue`);
  - `UnificationTable<K, V, E, S>` (+ `debug_UnificationTable`) and its type aliases `UnificationStorage`,
    `UnificationTableStorage`, `InPlaceUnificationTable`;
  - `Snapshot<Snap>`, `UnifyValue_unit`, `UnifyValue_Option`, `Range<T>`, `Some<T>`, and
    `StoreKey` / `StoreValue` / `StoreError`.
- `src/vendor/ena/unify/backing_vec.ts`:
  - the interfaces `UnificationStoreBase` / `UnificationStoreMut` / `UnificationStore` (+ `UnificationStoreBase_provided`);
  - `InPlace<K, V, E, L>`, `Delegate`, `InPlaceUndoLog`.
- `src/rustc_data_structures/snapshot_map/mod.ts`: `SnapshotMap<K, V, L>`, `UndoLog<K, V>`, `reverse_FxHashMap`,
  `SnapshotMapStorage`, `SnapshotMapRef`, and the re-export of `Snapshot`.
- `src/rustc_data_structures/sso/{mod,map,set}.ts`: `SsoHashMap<K, V>` (+ `Entry`, `debug_SsoHashMap`) and
  `SsoHashSet<T>` (+ `debug_SsoHashSet`).
- Tests:
  - `src/vendor/ena/snapshot_vec.test.ts`: the 3 `#[test]`s of snapshot_vec.rs;
  - `src/vendor/ena/unify/tests.test.ts`: all of unify/tests.rs, plus 2 rust-ts checks (below);
  - `src/vendor/ena/tests/external_undo_log.test.ts`;
  - `src/rustc_data_structures/snapshot_map/tests.test.ts`: all 3 upstream tests;
  - `src/rustc_data_structures/sso/sso.test.ts`: 6 rust-ts checks (upstream has no sso tests).

## Coverage (`bun scripts/coverage.ts --missing`, all complete)
ena (with the scope entry below in place):
| file | covered | notes |
|---|---|---|
| lib.rs | 0/0 | |
| undo_log.rs | 36/36 | 11 skips: the `&mut U` / `&mut T` forwarding impls |
| snapshot_vec.rs | 42/42 | 3 skips: the `&mut Vec` VecLike forwarding impl |
| unify/mod.rs | 38/38 | |
| unify/backing_vec.rs | 34/34 | 11 skips: `persistent` off |
| unify/tests.rs | 34/34 | 9 skips: `bench` off |
| tests/external_undo_log.rs | 19/19 | |
| bitvec.rs | 21/21 | skips: not a module |

rustc_data_structures: snapshot_map/mod.rs 12/12, snapshot_map/tests.rs 3/3, sso/mod.rs 0/0, sso/map.rs 44/44,
sso/set.rs 28/28.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/vendor/ena src/rustc_data_structures/snapshot_map src/rustc_data_structures/sso`: 28 pass, 0 fail.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3920 pass, 1 skip (already there, unrelated), 0 fail.
- `bun scripts/coverage.ts --check`:
  - without the scope entry, the only errors are the expected "names no harness/scope.json vendor crate at that
    version" errors (224) on the new `crate:` markers;
  - with the entry (temporary copy, not committed): `markers ok (7925; vendor 3888)`.
- No difftest sample was run. Nothing on a compiler path uses these modules yet, so every suite's output is
  unchanged by construction.

## Root: needed outside this lane
1. `harness/scope.json` `vendor`: add `"ena": "=0.14.4"`.
2. rustc_data_structures has no `lib.ts` yet. When one exists, it needs `pub use ena::{snapshot_vec, undo_log, unify};`:
   `export * as snapshot_vec from "../vendor/ena/snapshot_vec.ts"` (and the same for undo_log and unify/mod.ts).
   It also needs `pub mod snapshot_map; pub mod sso;`. rustc_type_ir's `data_structures` re-exports
   `NoError, UnifyKey, UnifyValue` from `vendor/ena/unify/mod.ts`.
3. No oracle probe yet: disk was too low to build one. Root-choice exactness rests on a line-by-line port plus
   the upstream tests and the rust-ts checks below. Suggested follow-up when disk allows: a rustc-dev probe
   (`extern crate ena` through `rustc_data_structures::unify`) that runs random new_key / union / unify_var_value /
   snapshot / rollback scripts and prints `find` and `rank` for every key. Diff it against the port.

## How dependants use it (rustc_infer / rustc_type_ir lanes)
```ts
import { InPlace, UnificationTable, type UnifyKey, UnifyKey_provided, NoError } from "../../vendor/ena/unify/mod.ts";
// impl UnifyKey for IntVid { type Value = IntVarValue; ... }  (rustc_type_ir ty_kind.rs:793 has its UnifyValue)
const IntVid_UnifyKey: UnifyKey<IntVid, IntVarValue, NoError> = {
  Value: IntVarValue_UnifyValue,           // { clone, unify_values }
  eq: (a, b) => a === b,                   // PartialEq; object keys (TyVidEqKey { vid }) compare fields
  index: (k) => k, from_index: (u) => u as IntVid, tag: () => "IntVid",
  order_roots: UnifyKey_provided.order_roots,   // TyVidEqKey / ConstVidKey override it
};
// InferCtxtInner: `ut::UnificationTableStorage::new()`
const storage = UnificationTable.new(() => InPlace.default(IntVid_UnifyKey, () => undefined));
// `storage.with_log(&mut undo_logs)`: an UndoLogs<sv::UndoLog<Delegate<IntVid>>> view of InferCtxtUndoLogs
storage.with_log(undo_logs_view).unify_var_var(a, b);
```
- `InferCtxtUndoLogs` (`impl<T> UndoLogs<T> where UndoLog: From<T>`) should follow
  `tests/external_undo_log.test.ts`: a per-`T` view (`as_(from)`) with the `From` conversion, and
  `Rollback<UndoLog>` on the storage dispatching to `UnificationTable.reverse` / `SnapshotVec.reverse` /
  `SnapshotMap.reverse`.
- `K1: Into<K>` arguments are not converted. Callers pass `K` (`TyVidEqKey::from(vid)`) themselves.
- `SsoHashMap.new(key: KeyType<K>, value: Layout)` / `SsoHashSet.new(key)` need the key's `Hash` + layout, as
  `FxHashMap` does. Keys are compared with `===`. `generalize.rs` keys on `(Ty, Variance, bool)` and
  `project.rs` dedups `PredicateObligation`s, so those callers need a primitive key encoding. Neither one
  iterates, but a migrated map's `KeyType` must still hash consistently.
- `SnapshotMap` is backed by a plain JS `Map`; it is never iterated. Its keys (`ProjectionCacheKey`) likewise
  need an identity-comparable representation.

## unported(...) left
None.

## PORT decisions (please record)
1. **Trait dictionaries.**
   - `UnifyKey<K, V, E>` carries `Value: UnifyValue<V, E>` (the associated type) and `eq` (the `PartialEq`
     supertrait). Keys are never compared with `===` inside ena.
   - `UnifyValue<V, E>` carries `clone` (the `Clone` supertrait).
   - `SnapshotVecDelegate<Value, Undo>` carries `clone_Value` (`D::Value: Clone`, for `update` / `Clone`).
   - `Delegate(K)` builds the delegate of a key. `PhantomData<D>` fields hold the dictionary.
   - Associated types become type parameters: `Snapshots<T, S>`, `UnificationStore<K, V, E, Snap>`, and the
     `Key` dictionary on the stores.
2. **Generic stores.** `UnificationTable<K, V, E, S>`, `SnapshotVec<Value, Undo, L>` and `SnapshotMap<K, V, L>` state
   upstream's where-clauses (`S: UnificationStoreMut`, `L: UndoLogs`, `L: Snapshots`, the default `VecLog`) as
   TS `this` types. `L = ()` is `undefined`. `UnificationTable.new` infers `K/V/E` from the store
   (`StoreKey/StoreValue/StoreError`).
3. **Vec-likes are arrays.** `V: VecLike` is always `Value[]`; `Vec` and `&mut Vec` are the same array, which
   `with_log` shares. The `&mut` forwarding impls are `crate-skip ... (erased)`, following anstream's precedent.
   Capacity (`reserve`, `with_capacity`) is not modeled.
4. **`&mut` values.**
   - In ena, `&mut D::Value` (`get_mut`, `update`'s op) is the element object itself. Values updated in place
     are objects (`VarValue`).
   - In sso, `&mut V` is a `MutRef<V>` view. For the `FxHashMap` representation, that view writes both the
     hashbrown bucket and the JS `Map`, without `insert` and so without `insert`'s `reserve(1)`.
   - `retain`'s `&mut V` is the value itself, as in vendor/hashbrown.
5. **Options.** `Option<V>` / `Option<&V>` with `V` possibly `undefined` is `{ $: "Some", _0 } | undefined`. This
   applies to `try_probe_value` and to `SsoHashMap.insert` / `remove`. `get` returns `V | undefined`, as in
   vendor/hashbrown. `UnifyValue_Option` maps `Option<V>` to `V | undefined`.
6. **sso.**
   - The enum is the `repr` field (`{ $: "Array", _0: [K, V][] } | { $: "Map", _0: FxHashMap }`).
   - `ArrayVec` is an array of at most 8 pairs: `swap_remove` and an order-preserving `retain`.
   - `drain` is eager.
   - `array.drain(..).collect()` is `FxHashMap.from_iter(pairs, len, ...)` (std's `with_hasher` + `extend`).
   - `HashMap::extend_reserve` (hashbrown: all of the hint when empty, half rounded up otherwise),
     `entry().or_insert_with` (`rustc_entry`), `get_mut`, `iter_mut` and `drain` are small helpers in map.ts,
     because rust_ts's `FxHashMap` lacks them.
   - The second `Extend<(&K, &V)>` / `Extend<&T>` impls' methods are suffixed `_ref`.
   - `Entry.key` (the field) is `key_`.
7. **Field/method clashes.** `VecLog.num_open_snapshots` is the field `num_open_snapshots_`; `debug_VecLog` prints the upstream name.
8. **Logging.** `debug!` (the log crate) stays a comment, and so do `debug_assert!`s. The test's
   `println!` in `OrderedKey::order_roots` is not reproduced.
9. **rust-ts checks.** `unify/tests.test.ts` adds two checks read off ena's source:
   - root choice under union-by-rank (equal ranks: `key_a` redirects to `key_b`), rank growth and path compression;
   - snapshot rollback of parents, ranks, values and `vars_since_snapshot`.

   `sso.test.ts` checks:
   - array order and `swap_remove`;
   - the 9th-key migration against an `FxHashMap` built the same way;
   - `shrink_to_fit` back to an array;
   - `get_mut` / `entry` / `values_mut` writing through in both representations;
   - `reserve`-triggered migration;
   - `SsoHashSet`.
