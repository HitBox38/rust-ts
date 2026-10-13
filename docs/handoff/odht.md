# Handoff: odht (wave 11b; vendor odht 0.3.1 for `def_path_hash_map`)

Branch `lane/odht`, based on 8005559. No merges.

odht **0.3.1** (the version in upstream's Cargo.lock) is vendored in full: 162/162 fns, counting the crate's own tests
and the bench / SSE2 skips. Read side, build side and Debug all match the oracle's own odht, which is the copy
linked into librustc_driver for aarch64-apple-darwin, together with rustc_hir_id's `Config`:
- generated build scripts: identical bytes;
- corrupted tables: identical error messages;
- the real `def_path_hash_map` of the sysroot's `core`, `alloc` and `std`: identical lookups.

The port also rebuilds those three crates' tables byte for byte, using `HashTableOwned::default()` + `insert` in
`DefIndex` order.

## Files (all new)
- `src/vendor/odht/lib.ts`: lib.rs. It contains:
  - `Config<K, V>` and `HashFn` (dictionary interfaces);
  - `HashTableOwned<K, V>`, `HashTable<K, V>` and `Iter`;
  - `bytes_needed`, `slots_needed`, `max_item_count_for` and `Factor`;
  - `debug_HashTableOwned`;
  - re-exports of `FxHashFn`, `UnHashFn`, `ByteArray` / `ByteArray_u8_array` and `Error`;
  - the `crate-skip`s for benches/bench.rs.
- `src/vendor/odht/{error,fxhash,unhash,memory_layout,raw_table}.ts` and `swisstable_group_query/{mod,no_simd}.ts`.
- Tests:
  - `lib.test.ts`: all lib.rs tests, including the 24×5 quickcheck properties on a seeded generator;
  - `raw_table.test.ts`: stress and probe_seq;
  - `swisstable_group_query/mod.test.ts`: 5 tests;
  - `odht.oracle.test.ts`: described below.
- `tools/probes/odht/{Cargo.toml.in,main.rs}`: a rustc-dev probe using `extern crate odht`, `rustc_hir_id`,
  `rustc_serialize` and `rustc_span`.

## Group query (oracle host)
odht's `cfg_if!` uses SSE2 only on x86/x86_64. On aarch64-apple-darwin (built without `no_simd`), it compiles
**no_simd**: `GROUP_SIZE` = 8, with u64 bit tricks. That is the version ported. sse2.rs is `crate-skip`ped with that
reason. The binary layout does not depend on the group size: probing always walks as if `REFERENCE_GROUP_SIZE` = 16.

## How rmeta-decoder-b / root use it
```ts
import { HashTable, HashTableOwned, type Config } from "../../vendor/odht/lib.ts";
const r = HashTable.from_raw_bytes(HashMapConfig, o);   // Result<HashTable<Hash64, DefIndex>, odht Error>
if (r.$ === "Err") return panic(`decode error: ${r._0}`); // Error.toString() is its Display (the message)
r._0.get(hash);                                           // DefIndex | undefined
```
The type parameter `C` is passed as the first argument of the static constructors (`from_raw_bytes`,
`from_raw_bytes_unchecked`, `default`, `with_capacity`, `from_iterator`, `init_in_place`) and of `bytes_needed`.
Tables keep it in `allocation.C`.

## Root: needed outside this lane
1. `harness/scope.json` `vendor`: add `"odht": "=0.3.1"`. With that entry (on a temporary copy, not committed),
   `coverage --check` prints `markers ok (7801; vendor 3664)`. Without it, the only errors are "names no
   harness/scope.json vendor crate" on the new markers.
2. Gate hosts: `bun scripts/probes.ts build odht`.
3. `src/rustc_hir_id/def_path_hash_map.ts` (not in my lane):
   - **`Config`**: add the associated types, so it satisfies odht's `Config<Hash64, DefIndex>`:
     `EncodedKey: ByteArray_u8_array(8), EncodedValue: ByteArray_u8_array(4), H: UnHashFn`. The oracle test
     builds exactly this object as `{ ...Config, EncodedKey, EncodedValue, H }`.
   - **`HashTableOwned` / `debug_HashTableOwned` stand-ins**: replace them with odht's. `DefPathHashMap` =
     `HashTableOwned<Hash64, DefIndex>`, and `HashTableOwned::default()` becomes `HashTableOwned.default(Config)`.
4. `src/rustc_metadata/rmeta/def_path_hash_map.ts` (rmeta-decoder-b or root): replace the `OdhtHashTable` stand-in
   with `HashTable<Hash64, DefIndex>`, as in the snippet above.

## Tests / checks
- `odht.oracle.test.ts` (probe-backed; a visible skip without the probe, a failure under
  `RUST_TS_REQUIRE_PROBES=1`):
  - **build**: 3000 generated scripts. They cover:
    - three configs: rustc's (u64→u32, UnHashFn), fx8 (u64→u32, FxHashFn) and fx4 (u32→u32);
    - every constructor: `default`, `with_capacity` at load factors 1..100%, and `from_iterator`;
    - up to 600 inserts, with duplicates/overwrites;
    - keys sharing their high or low halves (UnHashFn hashes the high half, so long collision chains);
    - 7 scripts where both sides panic in `grow` ("Allocation did not grow properly...").

    The insert results, `len` and raw bytes are identical.
  - **debug**: `{:?}` of 60 small tables is identical.
  - **get**: `from_raw_bytes` on 400 oracle-built tables plus a corrupted copy of each. The corruptions are tag,
    version, `size_of_*`, item count, slot count, truncated/extended data, control bytes, and non-zero empty
    slots. Results: the same `err` message, or the same `len`, iteration order and
    `get` on present and absent keys.
  - **readmeta**: the host sysroot's `libcore`, `liballoc` and `libstd` `.rmeta`:
    - the port's `MetadataBlob::get_root()` gives the `def_path_hash_map` position;
    - the probe reads it with the oracle's `MemDecoder`;
    - both sides agree on the byte length + FNV hash, `len`, all 125,744 iteration entries, and 25,300 lookups
      (every 5th key plus 50 absent keys per crate);
    - each table is rebuilt byte-identically.
  - **pinned bytes** (always runs): two oracle tables as hex.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3862 pass, 1 skip (already there, unrelated),
  0 fail.
- `--suite parse --sample 200` (run 20261013-191119-odht-k8e7): 200/200 MATCH.
- Coverage (`--missing`), all complete:
  - lib.rs 69/69, raw_table.rs 36/36, memory_layout.rs 19/19;
  - error.rs 1/1, fxhash.rs 3/3, unhash.rs 1/1;
  - swisstable_group_query/mod.rs 6/6 and no_simd.rs 5/5;
  - sse2.rs 4/4 (skips), benches/bench.rs 18/18 (skips).

## unported(...) left
Both are unreachable for tables rustc writes:
- `memory_layout.ts` `Allocation::header` on data shorter than the 32-byte header. Upstream reads out of bounds
  there (UB, guarded only by a debug assertion).
- `memory_layout.ts` `u64_le_to_usize`: a header `item_count` / `slot_count` ≥ 2^53. Such values only occur in
  corrupt tables.

## PORT decisions (please record)
1. **Dictionaries.**
   - `Config<K, V>` carries the associated types as dictionaries: `EncodedKey` / `EncodedValue` are `ByteArray`
     (with `LEN` = `size_of`), and `H` is a `HashFn`. `HashFn.type_name` is `std::any::type_name::<H>()`
     (`odht::unhash::UnHashFn` / `odht::fxhash::FxHashFn`, checked by the Debug test).
   - `ByteArray_u8_array(N)` is `impl ByteArray for [u8; N]`.
2. **Bytes are views.**
   - `[u8; N]` values and `D: Borrow<[u8]>` are `Uint8Array`s.
   - `Header` is a view over the table's first 32 bytes. The fields whose names clash with methods are
     `item_count_`, `slot_count_` and `max_load_factor_`.
   - `&[Entry<K, V>]` is an `EntrySlice` view. `Entry` holds key/value subarray views, `*entry = x` is
     `Entry_assign`, and `&mut EntryMetadata` is a `MutRef` view.
   - `HashTable` borrows its storage (zero-copy over the rmeta `OwnedSlice`). `HashTableOwned::from_raw_bytes`
     copies, as upstream does.
3. **Integers.** u64 group words and the FxHash state are `bigint`. `Factor::apply` / `apply_inverse` (u128
   upstream) compute in `bigint`. `usize` values are `number`, and `&` on masks goes through `bigint` above
   2^31. Header u64 values are read exactly below 2^53.
4. **Errors and results.** `Box<dyn Error>` is odht's `Error` class. `Result` is the `{ $: "Ok" | "Err" }` union.
   Assertion panics keep upstream's messages.
5. **Iterators.** `Iter`, `RawIter` and `GroupQuery` follow the JS iterator protocol.
   `HashTableOwned.from_iterator` takes an optional `size_hint`. It defaults to the exact length for arrays and to
   `(0, None)` otherwise.
6. **Tests.** The quickcheck properties use a fixed-seed generator (100 cases each, sizes up to 100, no
   shrinking). `usize::MAX` in the factor tests is 2^64, the nearest `number`.
