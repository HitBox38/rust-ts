verdict: APPROVE-WITH-NOTES

Lane rmeta-fxmap, branch `lane/rmeta-fxmap` (head 23219618). Reviewed the lane's own commits only: `git diff 2443856e lane/rmeta-fxmap`
(the merge of integ-w33), which covers 8 files, all under `src/` plus the handoff.

## What I checked and reproduced

- **Upstream sites.**
  - assoc.rs:142 `associated_types_for_impl_traits_in_trait_or_impl`: both arms are `.iter().filter_map(..).collect()` into
    `DefIdMap` = `UnordMap<DefId, _>`. unord.rs:473 `FromIterator` is `FxHashMap::from_iter`, which is `with_hasher` +
    `extend`. `extend` reserves `size_hint().0`, and that is 0 for `FilterMap`, so nothing is reserved; then one insert per
    kept item, in item order. The TS (`new FxDefIdMap` + one `set` per kept item, in the same order) matches. The two
    `Default::default()` returns stay empty plain `DefIdMap`s; an empty map is always encodable.
  - compare_impl_item.rs:709 `remapped_types`: `DefIdMap::default()`, inserts over the `FxIndexMap` `collected_types`
    (the TS keeps insertion order there), then the `contains_key`/`insert` loop for "missing synthetic item". The TS uses
    the same sequence on an `FxDefIdMap`.
  - The `UnordMap` derives `Encodable_NoContext` over `inner: FxHashMap`, so the encoded order is hashbrown's.
- **`FxDefIdMap` (def_id.ts:330).**
  - `set`/`delete`/`clear` mirror into `fx`. `extend` mirrors through `DefIdMap.prototype.set` (no double `fx.set`) and
    passes the size hint to `FxKeyedMap.extend`, the same as `from_iter_keyed`.
  - Both views keep the first key object for an existing key (`KeyedMap.set` and `FxKeyedMap.#store`).
  - All iteration (`entries`, `keys`, `values`, `@@iterator`, `forEach`) goes through `fx`. `get`, `has` and `size` come
    from the synced `KeyedMap`.
  - `DefId_fx_key` hashes the same `u64` as def_id.rs:269 (`(krate << 32) | index`, `write_u64`). Its layout is (8, 4).
  - The element layouts are right: `(DefId, Vec<DefId>)` = 32 bytes, and `(DefId, EarlyBinder<Ty>)` = 16 bytes
    (`EarlyBinder` is `T` + `PhantomData`).
  - The size argument also holds. In vendored hashbrown 0.17.1, raw.ts `capacity_to_buckets` uses the element size only
    for `size <= 3` and in `ensure_bucket_bytes_at_least_ctrl_align`. In any case the real layout is passed in.
- **`iterates_in_fx_order` / `FxOrdered`.** They accept an `FxHashMap` or any map whose `fx` is an `FxHashMap`.
  `encode_HashMap` and `debug_HashMap` iterate `v` itself, and that iterator is `fx`'s. A plain `DefIdMap` still stops as
  unported (the unit test checks this). This is correct and does not widen the check beyond maps that keep hashbrown order.
- **Markers and coverage.** No new upstream fns. The existing markers are unchanged. `coverage --check` gives "markers ok".
  No `unported(...)` was added or removed. No PORT comment hides a guessed value.
- **No tampering.** No file under `harness/`, `scripts/`, `harness/baseline` or `tools/` changed. There are no codegen
  changes.
- **Reproduced in a scratch worktree at 23219618.**
  - `bunx tsc --noEmit -p .`: clean.
  - `bun test src/rustc_span/def_id_fx.test.ts src/rustc_ty_utils/assoc.test.ts src/rust_ts/`: 23 pass, 0 fail.
  - Oracle (`nightly-2026-10-11`, commit 6f5da406b56c = the pin) against the port, `--target x86_64-unknown-linux-gnu
    --crate-type lib --emit=metadata`, on the lane's `a.rs`, `b.rs`, `c.rs` and `assoc2.rs`: all four have exit 0/0,
    identical stderr and IDENTICAL `.rmeta`.
  - The same crates on the base (merge 2443856e) stop with exit 70 at "HashMap Encodable iteration order", so the bytes
    really exercise the new maps.
  - `difftest --suite check-ui --filter fn-aux.rs` and `--filter arc_wake.rs` (3 of the 36 crates) are UNPORTED at
    "Decodable for rustc_crate_store::NativeLib", as the handoff says. This is not a lost MATCH: those crates were
    UNPORTED before too.
  - I did not rerun the mir, tydump-ui or borrowck-ui samples. The change only affects these two query values and the
    unported guard in encode/debug, so the claim that they are unchanged is plausible.

## Findings

1. **src/rustc_ty_utils/assoc_test/assoc.expected.txt:2,10 (non-blocking): the expectation change is justified.**
   - This is a hand-written port unit-test expectation (lane assoc-opaque). It is not an oracle output, a baseline or a
     suite definition, so AGENTS.md §2's ban does not apply.
   - The old content recorded the port's insertion order. Upstream's `UnordMap` never has that order.
   - The byte-identity argument is sound:
     - the rmeta encodes these maps as `len` followed by (DefIndex key, value) pairs in iteration order;
     - the keys are distinct, so any other order of the 4-entry trait map or the 3-entry impl map would change the bytes;
     - `assoc2.rs` only adds `lang_items` to the feature list and appends the lang items after the fixture's items, so
       the DefIndexes of the fns, and with them the hashes, are the same as in `assoc.rs`.
   - Note: the evidence lives only in `/tmp/fxlane/nc` (uncommitted). A committed oracle cross-check, such as an
     `assoc.oracle.test.ts` that compares rmeta for the fixture plus lang items, would make it durable. At minimum, root
     should cite it in the recorded decision.
2. **src/rustc_span/def_id.ts:319-402 (non-blocking): port glue inside a ported file.**
   - `FxDefIdMap` and `DefId_fx_key` are port-side glue placed in a ported file. PORTING §2 puts our own code in
     `src/rust_ts/`.
   - Placing it next to `DefIdMap` (D5) is defensible: it needs `DefId`/`DefId_key`, and `rust_ts/hash_map.ts` must not
     import rustc_span.
   - Root should record the decision the handoff proposes ("For root" #2), so later lanes use `FxDefIdMap` instead of
     inventing alternatives.
3. **src/rustc_span/def_id.ts:330 (non-blocking, informational): copies lose the hashbrown order, but safely.**
   - The two views stay in sync only through the overridden methods. A copy (`new DefIdMap(m)`, spreading into a new map)
     or a `Map.prototype.set.call(m, ..)` loses or desyncs the hashbrown order.
   - A copy fails safe: it becomes a plain `DefIdMap`, and encode/debug stop as unported.
   - A direct `Map.prototype` call would be silently wrong. I found none in `src/`.
   - The class comment could say "mutate only through the map's own methods".
4. **src/rust_ts/hash_map.ts:443-446 (non-blocking): `iterates_in_fx_order` duck-types on a property named `fx`.**
   - Any future map class with an `fx` field holding an `FxHashMap` that it does not iterate through would wrongly pass the
     guard.
   - This is acceptable for now (there is exactly one implementer). A brand or `instanceof` on an exported base would be
     stricter.
5. **docs/handoff/rmeta-fxmap.md "For root" #1 (non-blocking, not this lane's): stale pin.**
   - The stale `PENDING` pin in `compare_impl_item.oracle.test.ts` `end to end: refine_rpitit` was already on integ-w33.
   - The lane did not touch it and reported it correctly. Root should re-pin it at integration.

The order matches upstream's construction history. The hashbrown model is driven with the correct key hash and layout.
The oracle bytes match on crates that hit both maps, including resizes (b.rs, 40 fns) and multi-RPITIT entries (c.rs). No
protected case is affected.
