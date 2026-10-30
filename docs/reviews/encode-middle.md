verdict: APPROVE-WITH-NOTES

Reviewer: independent (read-only), wave 32. Batch: `lane/encode-middle`, own commits f65ed907 + 331be215,
diffed from merge c0793942 (integ-w32). Upstream: `.data/rust` at the pin.

## What was verified

- **ty/codec.rs encode side** (codec.ts), checked line by line against codec.rs:62-186:
  - `variant` (:72, :81);
  - `encode_with_shorthand` (:87): cache lookup, `emit_usize(shorthand)`, `start`/`len`, the `SHORTHAND_OFFSET > discriminant`
    assert, `leb128_bits >= 64 || shorthand < 1 << leb128_bits` (`2 ** leb128_bits` is exact for bits < 64);
  - `Ty` / `Predicate` (bound vars, then the shorthand of `skip_binder`) / `Clause` / `Pattern` / `ValTree` / `ConstAllocation` /
    `AdtDef` / `CtfeProvenance` (`into_parts` = `(alloc_id, immutable, shared_ref)`, pointer.rs:137) / `ParamEnv`.
  - The hand discriminant tables match the declaration order at the pin: `TyKind` ty_kind.rs, Bool=0..Error=28;
    `PredicateKind` predicate_kind.rs, Clause=0..NormalizesTo=6.
- **The other hand impls** all match upstream:
  - AllocFlags (allocation.rs:129): `trailing_zeros`, the `1<<6` mutability bit, the `all_zero<<7` bit, `u8`;
  - Allocation (:194), in field order;
  - ProvenanceMap (:53), with the `bytes.is_none()` assert and SortedMap = `Vec<(Size,V)>`;
  - InitMaskMaterialized (:198): u64 LE blocks from the D6 word pairs (low word first: correct for `to_le_bytes`);
  - ScalarInt (int.rs:172), Cache (basic_blocks.rs:156, empty), ClearCrossCrate (mod.rs:806), GenericArg, Term, RawList (slice);
  - `specialized_encode_alloc_id` (interpret/mod.rs:104): all 5 arms, discriminants, `is_thread_local_static` assert,
    `encode_def_id` for the Static arm.
- **Markers.** They are present and point at the right fn lines. `bun scripts/coverage.ts --check`: markers ok (23049; vendor 4680).
- **Generator.** serialize.json only adds `encode` templates that are symmetric to existing decode entries, plus 2 encode-only
  entries (`List`, `PolyExistentialPredicate`). I regenerated sets rustc_middle_ty_instance, rustc_ty and rustc_middle_mir in a
  scratch worktree. The tree stayed byte-identical (the generated files reproduce). Missing Decodable/Encodable: 0/0, 7/7
  and 0/0, as the handoff says.
- **hashbrown order / FxKeyedMap.**
  - FxKeyedMap stores the first key object per canonical key, so hashbrown's `===` equals `DefId: Eq`. `insert` on an
    existing key keeps the old key, as std does.
  - delete, clear, retain, extend and clone keep `#canon` consistent with the table.
  - Its hash is `DefId.hash` = `write_u64(krate<<32 | index)` (def_id.rs:269, matches). Its layout is (8,4) + u32 value:
    `(DefId,u32)` = 12/4, which is right.
  - The fxorder `def` kind is a sound oracle. It uses the real `rustc_span::def_id::DefId` in a real
    `FxHashMap<DefId,u32>` from the pinned crates, with the same op set as the existing kinds (insert, remove, reserve,
    shrink, clear, clone, retain, extend with exact and 0 hints, collect, with_capacity). Keys cover the high index bits
    and equal low bits.
  - The shared probe binary supports `def`. In the scratch worktree hash_map.oracle.test.ts gave 8 pass, 0 skip: the
    live def scripts (seed 2) ran against the probe.
- **param_def_id_to_index construction sites.** I compared all four with upstream:
  - generics_of.rs:55, :147 and :391, and rustc_ty_utils assoc.rs:347.
  - Each is `own_params.iter().map(..).collect()` over a Vec, so the exact size hint is `len`. The port's
    `from_iter(own_params.map(..), own_params.length)` inserts in the same order with the same hint.
  - No other `new Generics(` site exists outside tests.
- **Encode reach.** Only `Generics.param_def_id_to_index` (decodable.gen.ts:328) and rustc_ast `FormatArguments.names`
  reach `encode_HashMap`/`encode_HashSet`, as the handoff says. The guard (unported for a non-Fx Map/Set with >1 entry)
  is symmetric with `debug_HashMap` and is a correct "never guess" stop.
- **test_hash_map** (opaque/tests.rs:240). Moving it to FxHashMap is justified: upstream's RandomState is unmodelled and
  the new guard would refuse a plain Map. It is a round-trip test, so the semantics are kept, and there is a PORT comment.
- **harness/, scripts/, harness/baseline/:** no changes.
- **tsc and tests.** `bunx tsc --noEmit -p .`: clean. bun test on codec.test, rustc_serialize, hash_map.oracle,
  encoder_contract, mir/contract and codegen/serialize: 73 pass, 1 fail. The failure is environmental (finding 5).
- **Samples.**
  - The handoff claims per-case jsonl identical before and after on mir and tydump-ui (300 each).
  - My spot runs on the branch: mir `--filter impl-trait/in-trait` 94/94 MATCH; tydump-nocore
    `--filter generic-associated-types` 170/170 MATCH.
  - No lost MATCH seen.

## Findings

1. src/rustc_middle/ty/generics.ts:269-273 (also src/rustc_serialize/serialize_oracle/cases.ts:244, :255). Non-blocking.
   - The comments say upstream `HashMap::decode` is "`with_capacity_and_hasher(len, ..)`, then `insert`".
   - At the pin, serialize.rs:630-633 is `(0..len).map(..).collect()`, i.e. `with_hasher` + `extend`. `extend` reserves the
     exact size hint `len` on the empty table.
   - The resulting table is identical: on an empty table, `reserve(len)` resizes to `capacity_to_buckets(len)`, the same
     as `with_capacity(len)`. So nothing differs in output.
   - Fidelity and the comments should still follow upstream: build with `FxHashMap_DefId_u32.from_iter(map, map.size)`
     (and `FxHashMap.from_iter` / `FxHashSet.from_iter` in cases.ts), and fix the comment text.
2. src/rustc_middle/ty/generics.ts:255. Non-blocking.
   - `Generics.param_def_id_to_index` is still typed `Map<DefId, number>`. A future site that passes a plain Map or
     `KeyedMap` type-checks, and fails only at encode time through the unported guard; worse, its `get(def_id)` would
     silently compare `DefId`s by identity.
   - Type it `FxKeyedMap<DefId, number>` so the compiler enforces the "built with upstream history" rule the handoff
     gives to encoder lanes.
3. src/rustc_middle/ty/codec.ts:217 (`TyKind__discriminant`, `PredicateKind__discriminant`). Non-blocking.
   - The hand tables are correct at the pin (verified above).
   - They duplicate the generated `__variant_index` and can drift if the pin moves.
   - Follow-up: have codegen export the variant index under a non-colliding name and use it here.
4. src/rustc_middle/mir/mod.ts:930 `CLEAR_CROSS_CRATE_E`. Non-blocking, accepted as is.
   - rustc_middle lazily `require`s rustc_metadata/rmeta/encoder.ts, a layering inversion. It mirrors the existing
     decoder-side pattern and the PORT comment explains it. Non-EncodeContext encoders stop as unported, which is correct.
   - When the incremental `CacheEncoder` is ever ported, replace this with a per-encoder constant on the TyEncoder
     interface.
5. tools/codegen/serialize.test.ts:232. Informational, not this lane.
   - The test "derive(Decodable)/(Encodable) of hand types" fails when the repo is checked out under `.data/tmp/`. Its
     regex expects the import path to contain `/tmp/codegen-serialize-`, but there the relative path becomes
     `../../../codegen-serialize-…`.
   - It comes from encode-contract (0957f951), passes in the main checkout and is unaffected by this lane. Worth
     hardening, since reviewers use scratch worktrees under `.data/tmp`.
