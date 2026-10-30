# Handoff: lane rmeta-fxmap (wave 33 follow-up)

Branch `lane/rmeta-fxmap`, made from main `214d7137`. I merged `integ-w33` (head `24419792`) first, so the lane builds on
the full encoder.

## Which maps stopped

In check-ui run `20261030-203722-root-f5de-92kn`, 36 crates stopped at "std::collections::HashMap Encodable iteration
order". I printed a stack at `encode_HashMap` (temporary, reverted) and found only the two maps encoder-c reported, both
written by `encode_def_ids`:
- **35 crates:** `associated_types_for_impl_traits_in_trait_or_impl` (`encode_DefIdMap_Vec_DefId`). Every trait or trait
  impl with two or more fns has more than one entry, even with no RPITITs.
- **1 crate:** `collect_return_position_impl_trait_in_trait_tys` (`encode_DefIdMap_EarlyBinder_Ty`).

No other encoded map was reached.

## What changed

- **`src/rustc_span/def_id.ts`:**
  - `DefId_fx_key`: `impl Hash for DefId` as an `FxHashMap` key type.
  - `FxDefIdMap<T> extends DefIdMap<T>`: a `DefIdMap` that drives an `FxKeyedMap<DefId, T>` (`fx`) through every mutation
    and iterates in its order. Constructors: `new FxDefIdMap(valueLayout)` (`default()`) and `from_iter` (`collect()`).
  - PORT: why a subclass rather than a bare `FxKeyedMap` (encode-middle's `param_def_id_to_index` precedent):
    - both maps are query values, typed `DefIdMap<...>` by queries.gen.ts;
    - the extern-crate values decode to plain `DefIdMap`s (cstore_impl `decode_DefIdMap`);
    - an `FxKeyedMap` is not assignable to `DefIdMap` (`KeyedMap`'s `#canon` is nominal);
    - changing the `DefIdMap` typemap would change 8 queries' types, and making every `DefIdMap` hash-ordered would break
      the `DefIdMap`s that port `FxIndexMap<DefId, _>` (insertion order, recorded decisions).
- **`src/rust_ts/hash_map.ts`:**
  - `FxOrdered<K, V>` (a map that keeps its order in an `fx: FxHashMap`) and `iterates_in_fx_order(v)`;
  - `debug_HashMap` accepts `FxOrdered` maps;
  - `LAYOUT_PTR` and `LAYOUT_VEC` (`Layout`s of `&T`/`Ty` and `Vec<T>`).
- **`src/rustc_serialize/serialize.ts`:** `encode_HashMap` checks `iterates_in_fx_order(v)` instead of
  `v instanceof FxHashMap`. Its doc comment mentions `FxDefIdMap`.
- **`src/rustc_ty_utils/assoc.ts`:** both `collect()` arms of `associated_types_for_impl_traits_in_trait_or_impl` build an
  `FxDefIdMap<DefId[]>(LAYOUT_VEC)`.
  - PORT: `collect()` of a `filter_map` has size hint 0, so `FxHashMap::from_iter` is `default()` plus one `insert` per
    kept item, in item order. The existing loop does exactly that.
  - The two `Default::default()` early returns stay plain empty `DefIdMap`s.
- **`src/rustc_hir_analysis/check/compare_impl_item.ts`:** `remapped_types` (`DefIdMap::default()` plus inserts, then the
  "missing synthetic item" inserts) is an `FxDefIdMap<EarlyBinder<Ty>>(LAYOUT_PTR)`. `collected_types` is
  `FxIndexMap` upstream and stays insertion-ordered.
- **`src/rustc_span/def_id_fx.test.ts` (new):** checks that `FxDefIdMap` matches `FxKeyedMap<DefId, _>` (order, size and
  capacity) through inserts, removals, resizes, `from_iter` with both size hints, key-by-value and `clear`.
- **`src/rustc_ty_utils/assoc_test/assoc.expected.txt`:** this hand-written expectation listed the `rpitit` map in
  insertion order. It now lists the map in hashbrown order (two lines: `{provided, by_val, assoc_fn, by_ref}` and
  `{by_val, assoc_fn, by_ref}`). That order is confirmed against the oracle: `assoc.rs` with the needed lang items
  appended (so its DefIndexes don't move) gives byte-identical rmeta under the oracle and the port (5,192 bytes).

## The fxorder probe: no new kind

The key type is `DefId`, which the probe's existing `def` kind (`FxHashMap<DefId, u32>`) already covers. Its fixture
`fx_order_def.txt` checks `FxKeyedMap<DefId, _>`, and `FxDefIdMap` iterates exactly that map.

The value type only changes hashbrown's element size: 12 bytes for `def` against 32 and 16 bytes here. Element size
affects bucket placement only in two places:
- the small-table minimum capacity, which depends on element sizes of 3 bytes or less;
- `ensure_bucket_bytes_at_least_ctrl_align`, which never triggers with 8-byte keys.

So the order is the same.

## Oracle byte checks (no_core crates, `--emit=metadata`, x86_64-unknown-linux-gnu)

All of these give identical stderr, exit 0 and an identical `.rmeta` under the oracle and the port. Before the change,
each stopped UNPORTED on these maps; I checked that by reverting the sites one at a time.

| Crate | What it exercises | rmeta size |
|---|---|---|
| `a.rs` | trait with 9 fns plus an assoc type and const, and its impl | 5,607 bytes |
| `b.rs` | 40-fn trait and impl (resizes), plus a 2-fn trait | 15,253 bytes |
| `c.rs` | 13 RPITIT fns, one with 2 RPITITs; covers both maps, including `collect_return_position_impl_trait_in_trait_tys` with 2 entries | 12,524 bytes |
| `assoc2.rs` | the assoc_test fixture, see above | 5,192 bytes |

These crates live in `/tmp/fxlane/nc` and are not committed.

## Verification

- **`difftest --suite check-ui` (all 730, `RUST_TS_AGENT=root-f5de`, run `fxmap-check-ui-after`):** 8 MATCH / 722
  UNPORTED, the same as before (92kn: 8 / 722).
  - The 36 crates now all stop at "Decodable for rustc_crate_store::NativeLib (derive(Decodable) not generated)", lane
    rmeta-gaps-a's area. So their bytes can't be compared until that lands.
  - No other case changed status or stop.
  - Stops after: NativeLib Decodable 711, NativeLib Encodable 7, "Encodable without a TS impl" 4.
- **Samples (`--sample 300`, `RUST_TS_AGENT=root-f5de`) against root's base runs:**
  - mir: 297 MATCH / 1 UNPORTED / 2 UNSTABLE, unchanged from eeau.
  - tydump-ui: 298 MATCH / 0 UNPORTED / 2 UNSTABLE, unchanged (base fsk8: 298 / 0 / 2 UNSTABLE).
  - borrowck-ui: 300/300 MATCH, unchanged (base 46hd: 300 / 300).
- **`bun test`:**
  - src/rustc_span: 64 pass, 1 skip.
  - src/rust_ts: 20 pass.
  - src/rustc_serialize: 38 pass.
  - src/rustc_ty_utils: 32 pass.
  - src/rustc_metadata: 127 pass.
  - src/rustc_hir_analysis: 234 pass, 1 fail. The failure was there before this lane, see below.
- **`bunx tsc --noEmit -p .`:** clean.
- **`coverage --check`:** ok.

## Coverage

- def_id.rs: 52/52.
- assoc.rs: 12/12.
- compare_impl_item.rs: 35/35.
- serialize.rs: 107/107.

No new upstream fns: `FxDefIdMap` is port-side glue. `unported(...)` calls: none added, none left by this lane.

## For root

1. **Stale pin, not caused by this lane:** `compare_impl_item.oracle.test.ts` `end to end: refine_rpitit`.
   - `PENDING` pins the stop "rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)".
   - On integ-w33 the case already stops at "rustc_codegen_ssa::back::symbol_export::exported_non_generic_symbols_helper
     (codegen; M7)", with or without this lane (checked by reverting both sites).
   - Re-pin it when integrating w33.
2. **Decision to record:** query values typed `DefIdMap` whose `UnordMap` order crate metadata encodes are built as
   `FxDefIdMap` (rustc_span def_id.ts), a `DefIdMap` subclass that iterates in hashbrown order. `encode_HashMap` and
   `debug_HashMap` accept it through `iterates_in_fx_order` (rust_ts/hash_map.ts `FxOrdered`). Plain `DefIdMap`s keep
   insertion order.
3. Lane rmeta-gaps-a: the 36 crates are now behind the NativeLib codec like the rest of check-ui.
