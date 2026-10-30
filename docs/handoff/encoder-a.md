# Handoff: lane encoder-a (plan-m5 wave 33)

Branch `lane/encoder-a`, made from main `adaa9d4a` (wave 32 accepted, gate-20261030-102229-root-fsro).

## What landed

All 5 fns this lane owns (3 in encoder.rs, 2 hand impls outside it) are ported. None is left as a stub.

- **encoder.rs:402 `[u8]` encode** (`encode_slice_u8`): `Encoder::emit_usize(e, len)` then `emit_raw_bytes`.
- **encoder.rs:556 `encode_def_path_table`**: both branches.
  - proc-macro: `CRATE_DEF_ID` plus `tcx.resolutions(()).proc_macros`, through `defs.def_key` / `defs.def_path_hash`;
  - otherwise: `defs.enumerated_keys_and_path_hashes()`.

  `record_some_lazy!` and `record_value!` are expanded inline (`this.lazy(value, encode_DefKey)` then
  `tables.def_keys.set_some`; `tables.def_path_hashes.set(.., local_hash().as_u64())`). The upstream macro text is
  kept as a comment.
- **encoder.rs:577 `encode_def_path_hash_map`**: `this.lazy(BorrowedFromTcx(tcx.def_path_hash_to_def_index_map()))`.
- **rustc_hir_id definitions.rs:118 `Encodable for DefKey`** (`encode_DefKey`):
  `e.encode_def_key(parent, disambiguated_data)`, with the generated `encode_DisambiguatedDefPathData`. That encoder
  already exists in definitions.gen.ts, so the old stub's reason ("needs the derive") no longer held.
- **rustc_metadata def_path_hash_map.rs:36 `Encodable for DefPathHashMapRef`**:
  - `BorrowedFromTcx`: the odht `raw_bytes()` (length, then raw bytes), then
    `after_parallel_alloc.expect("must be set before metadata encoding").range(..)` encoded as a
    `[(Hash64, LocalDefId)]` slice;
  - `OwnedFromMetadata`: panics with upstream's message.

No hash maps or sets are encoded by these fns. `after_parallel_alloc` is a `SortedMap`, and the odht table is written
as its raw bytes, so the FxHashMap rule does not apply.

## Files touched

- `src/rustc_metadata/rmeta/encoder.ts`: the 3 fn bodies, plus imports (`CRATE_DEF_ID`, `DefPathHash`, `Hash64`,
  `encode_DefKey`, `encode_DefPathHashMapRef`).
- `src/rustc_metadata/rmeta/def_path_hash_map.ts`: the `encode` body, plus imports.
- `src/rustc_hir_id/definitions.ts`: the `encode_DefKey` body. Imports: added `type Encodable`, dropped the now-unused
  `unported`.
- `src/rustc_metadata/rmeta/encoder_contract.test.ts`, updated by the delta:
  - a new `ENCODER_A` line set, so `ported_by` credits :402/:556/:577 to encoder-a. The per-lane count stays
    `encoder-a: 3`, now all ported.
  - the "hand Encodable stubs outside encoder.rs" list goes from 2 entries to `[]`;
  - the `encode_def_path_table` probe is removed from "stubs stop with their lane", since encoder-a has no stubs left.
- New `src/rustc_metadata/rmeta/encoder_a.test.ts` (5 tests). Each round trip encodes with the port's `EncodeContext`
  over a `MemEncoder` and decodes with the port's decoders:
  - `[u8]`: exact bytes, including a 2-byte LEB128 length.
  - `DefKey`: exact bytes for the crate root and for a child. The parent is written as `Option<LocalDefId>` by the
    `EncodeContext` override. All keys decode back through the generated `decode_DefKey`.
  - `encode_def_path_table` + `encode_def_path_hash_map` on a real `Definitions`. It has 7 defs, 2 of them created after
    `commit_end_of_determinism`. The test encodes the `def_keys` / `def_path_hashes` tables, then:
    - every `LazyTable::get` → `LazyValue::decode` gives back its `DefKey` and its `local_hash`;
    - `decode_DefPathHashMapRef` gives an `OwnedFromMetadata` map (odht part plus a 2-entry sorted part) that resolves
      every `DefPathHash` to its index, and an unknown hash to `None`.
  - The proc-macro branch: only the root and the proc macro are recorded; the other rows are default.
  - The panics: `after_parallel_alloc` unset; `OwnedFromMetadata`.

## Coverage

- `coverage --missing compiler/rustc_metadata/src/rmeta/encoder.rs`: 26/95 → **29/95**. Nothing below :651 is
  missing.
- `def_path_hash_map.rs`: **3/3**. `rustc_hir_id/definitions.rs`: **26/26**.
- TOTAL 22,485 → **22,490** (+5), base `adaa9d4a`.
- `coverage --check`: markers ok (23,069; vendor 4,680).

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_metadata src/rustc_hir_id`: 130 pass, 0 fail (15 files).
- Samples (`RUST_TS_AGENT=root-f5de`). "before" is a temporary base worktree at `adaa9d4a`, removed afterwards:

  | suite | before (`adaa9d4a`) | after (this branch) |
  |---|---|---|
  | `mir --sample 300` | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run 20261030-193042-root-f5de-dydb) | same (run 20261030-193259-root-f5de-7wxr) |
  | `tydump-ui --sample 300` | 298 MATCH, 2 UNSTABLE, 15 skipped (run 20261030-193127-root-f5de-9xq3) | same (run 20261030-193428-root-f5de-5rq0) |

  The per-case `{id,status,unported}` sets are identical before and after (0 differing lines). The one UNPORTED case
  is the known `const-generics/transmute-fail.rs` (`rustc_abi::Size beyond 2^53`).
- **Small lib crate**, `--crate-type lib --emit=metadata`: a `no_core` crate with lang items `pointee_sized`,
  `meta_sized`, `sized` and `copy`, a struct, a fn and a const. The file is at
  `.data/tmp/w33/encoder-a-lib/lib.rs`, with an empty `--sysroot`.
  - The oracle exits 0 and writes `liblib.rmeta`.
  - The port gets through analysis (only the expected `internal_features` warning) and stops with exit 70 at
    `rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)`. That is the shim in
    `src/rustc_metadata/fs.ts:320`, so encoding stops at the very first fn, before any encoder.ts code runs.
  - This lane's fns are reached only once encoder-d wires `encode_metadata` → `with_encode_metadata_header` and
    encoder-b ports `encode_crate_root` (which calls `encode_def_path_table` / `encode_def_path_hash_map`).

## `unported(...)` left

None in this lane's fns.

## PORT decisions (in the code)

- `encode_DefKey` passes `gen.encode_DisambiguatedDefPathData` cast to `Encodable<DisambiguatedDefPathData>`.
  - **Why:** rustc_span's `SpanEncoder.encode_def_key<T>` declares its argument as `Encodable<T>` (over `Encoder`),
    while upstream's is `impl Encodable<Self>`. Every implementation calls it with `self`, a `SpanEncoder`, so the cast
    is sound.
  - **For root (not done, rustc_span is not my file):** the cleaner fix is to type the interface parameter as
    `Encodable<T, SpanEncoder>` in `src/rustc_span/lib.ts:1647/1658`.
- `.range(..)` on `SortedMap` is `range(range_full())`. `.expect(msg)` is `unwrap(v, msg)`. The `[(Hash64, LocalDefId)]`
  slice is `encode_slice` with `encode_tuple(encode_Hash64, encode_LocalDefId)`, the inverse of the decoder's
  `Vec<(Hash64, DefIndex)>`.
- `Encoder::emit_usize(e, self.len())` (UFCS) is `e.emit_usize(self.length)`.

## For root

- Nothing to record beyond the ownership already recorded (encoder-a = `[u8]` :402, :556, :577 and the two hand
  impls).
- The `encode_def_key` typing note above is optional.
