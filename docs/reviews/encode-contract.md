verdict: APPROVE-WITH-NOTES

Reviewer: independent review of `lane/encode-contract` (0957f951, base main c58a6fc4), wave 32, contract-first.
Read-only. A scratch worktree was used for the checks below and has been removed.

## What was checked

- **Derives vs rustc_macros/src/serialize.rs `encodable_body`.**
  - Fields are encoded in declaration order, using the same `liveFields` / `enabled` variant filter as the decoder.
  - Unit-like types and single fieldless variants encode nothing.
  - The discriminant is `emit_u8` when there are fewer than 255 variants, else `emit_usize`. This matches upstream's `variant_idx < u8::MAX` and mirrors the decoder's `read_u8` / `read_usize`.
  - The second `match` is emitted only when some variant has fields.
  - Encoder types match upstream:
    - `Encodable` takes a `SpanEncoder`;
    - `Encodable_NoContext` takes an `Encoder`;
    - `TyEncodable` takes a `TyEncoder`;
    - `MetadataEncodable` takes the `EncodeContext`.
  - The rustc_ty `encoders` override mirrors `decoders`.
  - Upstream has no `BlobEncodable` / `LazyEncodable` derive (rustc_macros lib.rs:81/113/120/142), so the lane's claim is correct.
  - Spot checks against upstream:
    - `encode_CrateRoot`: all 49 fields in rmeta/mod.rs:270 order;
    - `encode_CrateRootUnhashed` and `encode_RawDefId`;
    - `encode_CrateDep`: `Encodable`, i.e. a SpanEncoder, as upstream;
    - `encode_InlineAsmReg`;
    - `encode_Generics`, `encode_AdtDefData`, `VariantFlags`, `ReprFlags`.
- **Generator changes (tools/codegen/types.ts).**
  - The changes are `serItemEntry(kind)`, `encTemplate`, the `encFn` item-entry path, the `unported_encodable` shortcut, the generic `encHead` and the per-set `encoders`. Each one exactly mirrors its decode counterpart.
  - Generation is deterministic: regenerating the sets `rustc_metadata_rmeta`, `rustc_ty`, `rustc_span` and `rustc_middle_mir` on the branch gave zero drift against the committed `.gen.ts` files.
- **`EncodeContext`.**
  - Fields: all 15 fields of encoder.rs:52, in order. The `_` suffixes for clashes and the `Map<T, index>` used for `FxIndexSet` are both justified in PORT comments.
  - `Encoder` impl: `encoder_methods!` delegates to `opaque`, and the provided methods (`emit_i8/bool/char/str/byte_str`) stay on `self`. This matches the upstream trait.
  - `TyEncoder` impl :411–:423: `encode_alloc_id` is the `insert_full` index, then `usize::encode`.
  - `emit_lazy_distance` :472, `lazy` :494 and `lazy_array` :510 match upstream: assertion texts, state transitions and `NonZero` unwraps.
  - The `LazyValue` / `LazyArray` / `LazyTable` writers :122/:128/:137 and `ExpnIndex` :145 match.
  - `encode_LazyTables` has the same field order and count as `decode_LazyTables`.
- **Split table.**
  - Recomputed from upstream: 95 fns = 11 + 16 + 2 + 15 + 16 + 35. The contract test pins the same split, and it matches plan-m5 waves 32/33 apart from the hygiene / source-map question (finding 1).
  - Every stub's `unported` text names its lane.
- **Encodable `rustc-skip` conversion.** Exactly 37 markers were removed: 12 ported plus 25 stubs, the same lists as the handoff.
  - The 12 ported impls each match upstream:
    - vec.rs:372;
    - fingerprint.rs:172 and :216;
    - tuple.rs:55: `path_for_rustdoc` is not encoded;
    - tokenstream.rs:149: the panic text matches;
    - `DocAttribute` :523: 22 fields in order, plus the `inline` filter;
    - type_ir serialize.rs :28, :62, :84, :105 and :125;
    - codec.rs:170.
  - The hand-expanded `PanicStrategy` / `SymbolManglingVersion` encoders use upstream variant order with `emit_u8`. `encode_Svh` is the derived `Encodable_NoContext`.
- **Protected paths.** No changes to `harness/`, `scripts/`, baselines, `UPSTREAM.json`, `package.json`, `tsconfig.json`, PORTING or AGENTS. The pinned `mir/contract.test.ts` delta (`encode-middle: 7`) is disclosed and justified.
- **Runtime import graph.**
  - The only new value imports are leaf `std/panic.ts` (four `.gen.ts` files plus basic_blocks.ts) and an attr_ir → rustc_ast/attr edge that already existed.
  - `import { type EncodeContext } from "./rmeta/encoder.ts"` in rustc_metadata/decodable.gen.ts is elided by Bun even under `verbatimModuleSyntax`; I verified this empirically. So encoder.ts is still not loaded at startup, as claimed.
- **Results on the branch.**
  - `bunx tsc --noEmit -p .` is clean.
  - `bun scripts/coverage.ts --check` reports "markers ok (22978; vendor 4680)", matching the handoff.
  - `encoder_contract.test.ts` (8 tests) and `mir/contract.test.ts` pass.
  - The crate tests (rustc_serialize, metadata, span, index, target, type_ir, data_structures, middle) give 866 tests, 0 fail, 1 skip.
  - My own sample `difftest --suite mir --sample 60` (`RUST_TS_AGENT=rev-encc`, run 20261030-084958-rev-encc-bw29) gave 60/60 MATCH.
  - The lane's before/after samples are plausible: nothing calls the encoders yet, and the decode output and import graph are unchanged.

## Findings

1. **rustc_metadata/rmeta/encoder.ts:419 (`encode_source_map` stub) and :2036 (`encode_hygiene` stub). Non-blocking; root decision.**
   - plan-m5 is ambiguous about both.
   - `encode_hygiene` is named by encode-span-hygiene (wave 32) and also by encoder-c (":1482–:2040 … hygiene").
   - `encode_source_map` :581 falls inside encoder-a's ":1–:650" range, though encode-span-hygiene names it explicitly.
   - The lane gave both to encode-span-hygiene. That is the more specific entry, and the contract test pins it.
   - I agree with this choice. Root should record it as a decision (`state.ts record decision`) so encoder-a and encoder-c do not dispute it.

2. **src/rustc_serialize/serialize.ts:797 `encode_HashMap` / :820 `encode_HashSet` (pre-existing, not this lane's code). Non-blocking; a risk the generated encoders now inherit.**
   - These iterate the JS `Map` / `Set` in insertion order. Upstream `FxHashMap` / `FxHashSet` iterate in hashbrown bucket order.
   - The generated encoders now route real metadata fields through them:
     - `encode_Generics` → `param_def_id_to_index: FxHashMap<DefId, u32>`, rustc_middle/decodable.gen.ts:332, encoded via the `generics_of` table;
     - rustc_ast format.gen.ts:167 `names`.
   - Under D4 (byte-identical rmeta) these bytes will differ from the oracle whenever the map has 2+ entries.
   - Root should route this to encode-middle / encoder-c, or to a rustc_serialize fix, before rmeta suites gate on it. Not a reason to hold this lane.

3. **src/rustc_target/asm/mod.ts `encode_fieldless_enum`. Non-blocking.**
   - `if (disc < 0) panic(\`${ty_name}: not a variant\`)` is a guard with invented panic text, for a state the types make impossible. Upstream has no such path.
   - It is harmless (it would be an ICE either way). For fidelity, prefer `unreachable(...)` or drop the guard.

4. **src/rustc_data_structures/fingerprint.ts (`encode_Fingerprint` / `encode_PackedFingerprint`). Non-blocking, style.**
   - The `// rustc:` marker is followed by a `/** impl … */` doc comment before the `export function`, so it is not literally "directly above" the fn as PORTING §3 says.
   - `coverage --check` accepts it. Swap the two lines next time the file is touched.

5. **tools/codegen/serialize.test.ts:232. Informational; not the lane's change, so the test file is unchanged by this.**
   - The import-path regex requires `/tmp/codegen-serialize-` in the relative path. It fails when the checkout itself lives under `.data/tmp`, e.g. a reviewer worktree, because `test_scratch_dir` then resolves to a sibling path without `/tmp/`.
   - It passes from the main checkout. The lane's claim of "all pass" holds for a normal checkout.

6. **Handoff accuracy. Non-blocking.**
   - The handoff says `std/panic.ts` was added to "four files". It is four `.gen.ts` files plus the hand module rustc_middle/mir/basic_blocks.ts, which needs it for its stub.
   - Every other claim I checked was accurate: counts, coverage and the stub lists.
