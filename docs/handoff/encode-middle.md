# Handoff: lane encode-middle (plan-m5 wave 32)

Branch `lane/encode-middle`, made from main `06d07cf8` with `git merge integ-w32` first (builds on encode-contract's
`EncodeContext` skeleton, `TyEncoder` and the `Encodable` codegen).

## What landed

1. **ty/codec.rs encode side** (src/rustc_middle/ty/codec.ts). Ported:
   - `variant` (:72 `Ty`, :81 `PredicateKind`);
   - `encode_with_shorthand` (:87);
   - `Encodable` for `Ty` (:126), `Predicate` (:132), `Clause` (:140), `Pattern` (:146), `ValTree` (:152),
     `ConstAllocation` (:158), `AdtDef` (:164), `CtfeProvenance` (:176), `ParamEnv` (:182).

   The final `encode_with_shorthand` signature takes a function table: `encode_with_shorthand(encoder, value, cache, T_)`,
   where `T_: EncodableWithShorthand<T, Variant, K>` carries `variant`, `encode_variant`, `discriminant` and `key`. The
   tables are `EncodableWithShorthand_Ty` and `EncodableWithShorthand_PredicateKind`.
2. **The other middle hand impls:**
   - ty/mod.rs:634 `Term`, generic_args.rs:366 `GenericArg`, list.rs:199 `RawList`, consts/int.rs:172 `ScalarInt`;
   - mir/mod.rs:806 `ClearCrossCrate`, basic_blocks.rs:156 `Cache`;
   - interpret allocation.rs:129 `AllocFlags` and :194 `Allocation`, provenance_map.rs:53, init_mask.rs:198;
   - interpret/mod.rs:104 `specialized_encode_alloc_id`.

   That is all 23 encode-middle stubs of the contract test. **AllocId encoding:** upstream has no `AllocEncodingState`
   (only `AllocDecodingState`). The encode side is `TyEncoder::encode_alloc_id` (already ported by encode-contract:
   `interpret_allocs.insert_full`), `Encodable for AllocId` (codec.rs:170, also already ported) and
   `specialized_encode_alloc_id` (now ported; its caller is encoder.rs:724, lane encoder-b).
3. **codec.ts adapters for the generated encoders.** They mirror the decode adapters, load their callees lazily and are
   not markers:
   - `encode_List` (any `&List<T>`, for `Place.projection`);
   - `encode_List_Ty`, `encode_List_BoundVariableKind`, `encode_List_Pattern`, `encode_List_Const`,
     `encode_List_PolyExistentialPredicate`, `encode_ListWithCachedTypeInfo_Clause`, `encode_GenericArgs`,
     `encode_CanonicalVarKinds`;
   - `encode_GenericArg_TyEncoder`, `encode_Term_TyEncoder`, `encode_ty_Const`, `encode_Value`,
     `encode_PolyExistentialPredicate`.

   tools/codegen/serialize.json gained `encode` templates:
   - on the existing entries for `I::Tys` / `BoundVarKinds` / `Consts` / `PatList` / `BoundExistentialPredicates` /
     `Clauses` / `GenericArgs` / `GenericArg` / `Term` / `CanonicalVarKinds` / `ValueConst`, `ty::Const`, `Binder`
     (`encode_Binder($v, $E, $e0, encode_List_BoundVariableKind)`) and `UnsafeBinderInner`;
   - on two new encode-only entries, `rustc_middle::ty::list::List` and `PolyExistentialPredicate` (their decoding goes
     through the `&List<..>` RefDecodable entries).

   All 17 Encodable sets were regenerated, and 16 generated files changed. Missing Encodable count per set:

   | set | before | after |
   |---|---|---|
   | rustc_ty | 19 | 7 |
   | rustc_middle | 1 | 0 |
   | rustc_middle_mir | 3 | 0 |
   | rustc_middle_ty_instance | 1 | 0 |
   | rustc_middle_typeck_results | 1 | 0 |

   The rustc_ty 7 left are exactly the 7 with no decoder either: `I::LocalDefIds`, `I::PredefinedOpaques`,
   `I::RegionAssumptions`, `mir::BinOp`, `mir::UnOp`, `abstract_const::CastKind`, `ImplTraitInTraitData`. That is
   `missing Decodable/Encodable: 7/7`. rustc_metadata_rmeta keeps its 17 phantom `Lazy*` arguments (nothing to do).
4. **HashMap / HashSet encode order** (routed from the encode-contract review).
   - **Mechanism.** The repo already reproduces hashbrown order: src/rust_ts/hash_map.ts `FxHashMap` / `FxHashSet` are
     JS `Map` / `Set`s that also drive the vendored hashbrown 0.17.1 table with FxHasher (lane hashbrown-order). The
     `fxorder` probe proves their iteration order against the oracle. The serialize probe's `FxHashMap_u32_u64` /
     `FxHashSet_u32` cases prove that `encode_HashMap` / `encode_HashSet` write that order byte for byte.
   - **The guard.** `encode_HashMap` / `encode_HashSet` now stop as `unported(..)` on a plain `Map` / `Set` with more than
     one entry, exactly like `debug_HashMap` / `debug_HashSet`. Such a map has lost the history that decides the order.
   - **`Generics.param_def_id_to_index`.** This is the `FxHashMap` that rmeta exposes, and it was a `KeyedMap`, so it
     iterated in insertion order. It is now an `FxKeyedMap<DefId, u32>`, a new class in hash_map.ts: `FxHashMap` order
     plus `KeyedMap`'s by-value keys. Its hash is `impl Hash for DefId` (`DefId.hash`, one `u64`) and its layout is
     (8, 4), with a `(DefId, u32)` element of 12 bytes. It is built by `FxHashMap_DefId_u32.from_iter` (ty/generics.ts)
     at the 4 upstream `collect()` sites (generics_of.rs ×3, rustc_ty_utils assoc.rs ×1), and by `with_capacity(len)`
     plus inserts in `Generics::from_decoded` (upstream's `HashMap::decode`).
   - **Oracle proof.** The `fxorder` probe gained a `def` kind (`FxHashMap<DefId, u32>`, key token `<krate>.<index>`).
     `gen_def` reuses the existing script generator with the kind forced, so `gen` and fx_order.txt are unchanged.
     6,000 random scripts (seeds 1–3: inserts, removals, reserve/shrink, clear, clone, retain, extend, collect,
     with_capacity) match the oracle with 0 mismatches. They replay fresh `DefId` objects per op, so the
     canonicalization is exercised too. The committed fixture is `src/rust_ts/hash_map_oracle/fx_order_def.txt`
     (gen_def(1, 1500), always replayed), plus a live-probe test (seed 2) and an `FxKeyedMap` API test.
   - **Scope.** The only generated encoders that reach `encode_HashMap` are `Generics.param_def_id_to_index` (rmeta)
     and rustc_ast `FormatArguments.names`, which is already an `FxHashMap` and is not in rmeta. Every other
     `FxHashMap` / `FxHashSet` that encoder.rs encodes by hand must be built as `FxHashMap` / `FxHashSet` by the lane that
     ports it, or it stops at the guard. This is not a whole-port change.

## Tests

- New src/rustc_middle/ty/codec.test.ts, 7 round trips with the port's own decoders. The encoder is `EncodeContext`
  over a `MemEncoder`; the decoder is a minimal test `TyDecoder`.
  - **`Ty`:** full encodings, then shorthands, checked against the upstream rule: `Int(I32)` at 0 is cached (14 bits),
    `Never` never is, and a repeated tuple is a 2-byte LEB128 shorthand. Every type decodes back to the same interned
    object; the types include `Array` with a `ConstKind::Value` / `ValTree` / `ScalarInt`, `Ref`, `Slice` and `Tuple`.
  - **`Predicate`:** bound vars, then the shorthand for `Coerce`; `Ambiguous` is not cached.
  - **The rest:** `GenericArgs`; `ScalarInt` bytes; `Allocation` (flags byte, the all-zero case, provenance, init mask);
    `InitMaskMaterialized`; `ClearCrossCrate` (no bytes for crate metadata).
- `specialized_encode_alloc_id` is not unit-tested: it needs `tcx.global_alloc` and an alloc map. It is a direct
  transcription.
- Pinned tests updated by the delta:
  - encoder_contract.test.ts: the hand-impl stub list loses its 23 encode-middle entries (2 encoder-a stubs left);
  - mir/contract.test.ts "stubs per fill lane": `{"encode-middle": 7}` → `{}`.

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (23,049; vendor 4,680).
- Coverage: TOTAL 22,447 → **22,470** (+23). These are against this lane's base, main + integ-w32. Per file:

  | | before | after |
  |---|---|---|
  | rustc_middle | 3,043 | 3,066 |
  | ty/codec.rs | | 50/50 |
  | interpret/allocation.rs | | 51/51 |
  | interpret/mod.rs | | 29/29 |
  | ty/list.rs | | 22/22 |
- `bun test`: all pass.
  - src/rustc_middle, src/rustc_serialize, src/rustc_metadata, tools/codegen and rust_ts/hash_map.oracle.test.ts:
    564 pass, 0 fail;
  - src/rustc_hir_analysis, src/rustc_ty_utils and src/rust_ts: 286 pass, 0 fail.
- Samples (`RUST_TS_AGENT=root-f5de`): base checkout of this lane's base (`c0793942`, a temp worktree, removed) vs this
  branch:

  | suite | before | after |
  |---|---|---|
  | `mir --sample 300` | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run 20261030-085524-root-f5de-87g4) | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run 20261030-091405-root-f5de-fmyb) |
  | `tydump-ui --sample 300` | 298 MATCH, 2 UNSTABLE, 15 skipped (run 20261030-085623-root-f5de-7ubv) | same (run 20261030-091500-root-f5de-eptz) |

  The per-case jsonl files (`id`, `status`, `unported`) are identical before and after: 0 differing lines in both suites.
  The one UNPORTED mir case is unchanged (`const-generics/transmute-fail.rs`, `rustc_abi::Size beyond 2^53`).

## `unported(...)` left

- rustc_serialize serialize.ts:
  - `std::collections::HashMap Encodable iteration order (hashbrown + FxHasher; not an FxHashMap)`;
  - `.. HashSet .. (not an FxHashSet)`.

  These are the guard above.
- mir/mod.ts `CLEAR_CROSS_CRATE_E`: `rustc_middle::query::on_disk_cache::CacheEncoder (TyEncoder::CLEAR_CROSS_CRATE)`.
  Incremental is out of scope; only `EncodeContext` is a `TyEncoder`.
- Generated `unported_encodable` (unchanged, symmetric with missing decoders): the 7 rustc_ty entries listed above.

## `// PORT:` decisions

- codec.ts:
  - **`EncodableWithShorthand`.** It is a function table (`variant`, `encode_variant` = `T::Variant: Encodable`,
    `discriminant` = `intrinsics::discriminant_value`, `key` = the cache key), and `encode_with_shorthand` takes it as
    `T_`.
  - **The discriminants.** `TyKind__discriminant` / `PredicateKind__discriminant` are hand tables of the variant index.
    Neither enum has explicit discriminants, and the generated `__variant_index` fns are module-private (exporting them
    from codegen would collide through `export *`).
  - **The predicate cache key.** `predicate_shorthands` keeps its `Map<string, number>` key (encode-contract), so the
    key of a `PredicateKind` is `intern_key(kind)`.
  - **`encode_Allocation`.** The private `encode_Allocation` (`Allocation<CtfeProvenance, (), Box<[u8]>>`) mirrors
    `decode_Allocation`.
- mir/mod.ts: `E::CLEAR_CROSS_CRATE` is `CLEAR_CROSS_CRATE_E(e)`, an `instanceof EncodeContext` check through a lazy
  `require` of rmeta/encoder.ts, mirroring the decoder side.
- allocation.ts:
  - `AllocFlags`'s `const { assert!(..) }` is kept as a comment;
  - `align.bytes().trailing_zeros()` is computed with `clz32`;
  - the stale "only used by the (skipped) `Encodable` impl" note on `all_zero` is removed.
- init_mask.ts: the D6 32-bit word pairs are written as u64 little-endian blocks; the block count is
  `blocks.length / 2`.
- provenance_map.ts: `encode_SortedMap_Size` is hand-expanded, mirroring `decode_SortedMap_Size`.
- generics.ts: `FxHashMap_DefId_u32` (`with_capacity`, `from_iter`) and `DefId_fx_key`; `from_decoded` rebuilds the map
  as upstream's decode does.
- serialize.ts: the `encode_HashMap` / `encode_HashSet` guard.
- rustc_serialize opaque/tests.test.ts `test_hash_map`: upstream uses `HashMap::new()` (`RandomState`, not modeled). The
  port uses an `FxHashMap<i64, i64>` (`write_i64`, 8 bytes).
- serialize_oracle/cases.ts: the `FxHashMap_u32_u64` / `FxHashSet_u32` cases decode into Fx collections
  (`with_capacity(len)` + inserts, upstream's decode). Re-encoding them still matches the oracle's bytes (the live
  probe test passes).

## Out-of-lane edits (root to accept)

- **src/rust_ts/hash_map.ts:** new `FxKeyedMap`.
- **src/rust_ts/hash_map_oracle/scripts.ts:** the `def` kind, `gen_def`, `fixture-def`.
- **src/rust_ts/hash_map.oracle.test.ts and fx_order_def.txt:** new tests and fixture.
- **tools/probes/fxorder/main.rs:** the `def` kind; `run_map` is generic over the value type.
  - **The shared binary.** I rebuilt the probe into the shared `$RUST_TS_DATA/target/probes/release/fxorder` from this
    branch. It is a superset, and existing kinds answer identically: the fx_order.txt fixture still replays.
  - **Rebuild risk.** If anyone rebuilds `fxorder` from main before this merges, the live `def` test fails with
    "bad kind def". The committed fixture does not depend on the binary.
- **src/rustc_hir_analysis/collect/generics_of.ts (3 sites) and src/rustc_ty_utils/assoc.ts (1 site):** these build
  `param_def_id_to_index` with `FxHashMap_DefId_u32.from_iter`.
- **rustc_serialize:** the test changes above.
- **tools/codegen/serialize.json and the 16 regenerated `.gen.ts` files.**

## Notes for root

- The encoder lanes (encoder-a..d) must build every `FxHashMap` / `FxHashSet` they encode, or iterate into the output,
  as rust_ts/hash_map.ts `FxHashMap` / `FxHashSet` (or `FxKeyedMap` for struct keys), with the upstream construction
  history: `default` / `with_capacity` / `from_iter` with the iterator's lower size hint. Otherwise `encode_HashMap`
  stops as UNPORTED, which is the intended behaviour. Worth a line in their lane instructions.
- `FxKeyedMap` costs a hashbrown insert per generic parameter in `generics_of`. That is small (a few params per item).
  The after-samples show no new TIMEOUT.
