# Handoff: hashbrown-order (wave 9, M2; vendor port)

FxHashMap / FxHashSet iteration order is ported. It matches the oracle compiler's own
`rustc_data_structures::fx` maps on 18,000+ random operation scripts, all of them identical. The 6
pending `format_args!` cases and `c_doc_auto_cfg_multi` now match the oracle.

## Findings
- **Versions.** `rustc_data_structures::fx` re-exports **rustc-hash 2.1.1**: `FxHashMap<K, V>` =
  `std::collections::HashMap<K, V, FxBuildHasher>`. rustc-hash 1.1.0 is in Cargo.lock for other
  dependencies. The `nightly` feature is off, so `write_str` is std's provided method
  (`write(bytes)` + `write_u8(0xff)`) and `write_length_prefix` is `write_usize`.
  std's hashbrown and rustc_data_structures' own hashbrown are both **0.17.1**
  (library/Cargo.lock, Cargo.lock).
- **Oracle host group.** On aarch64-apple-darwin (neon is a baseline feature, little-endian,
  not miri), hashbrown's `cfg_if!` picks **NEON**: `Group::WIDTH` = 8, `BitMaskWord` = u64,
  stride 8. The generic 64-bit group would place buckets the same way (same width and same
  empty/full masks; its `match_tag` false positives are filtered by `eq`).
- **Which maps are deterministic.** All the pending cases are Fx (unseeded) maps:
  - `FormatArguments::names`: `FxHashMap<Symbol, usize>`, created by `FxHashMap::default()`, insert-only.
  - doc.rs `cfg_names`: `FxHashSet<Symbol>`.
  - mbe `NamedMatches`: `FxHashMap<MacroRulesNormalizedIdent, _>`.

  `std::collections::HashMap::new()` (RandomState) is not modeled.
- **What decides the order.** Bucket order depends on the element size as well as the keys:
  with `size_of::<(K, V)>() <= 1`, the minimum table has 8 buckets instead of 4. It also depends
  on capacity requests and on the size hint passed to `collect` / `extend`. The `KeyType` and
  `Layout` arguments carry this information.

## Files
New:
- `src/vendor/rustc_hash/{lib,seeded_state}.ts` and `{lib,seeded_state}.test.ts`: FxHasher,
  hash_bytes, multiply_mix, FxBuildHasher, FxSeededState, plus the crate's unit tests (they pass,
  so the hash values are pinned). `random_state.rs` is `crate-skip` (feature `rand`, which is off).
- `src/vendor/hashbrown/control/{tag,bitmask,mod}.ts`, `control/group/{mod,neon}.ts`.
- `src/vendor/hashbrown/raw.ts` (+ `raw.test.ts`, which ports test_prev_pow2,
  test_minimum_capacity_for_small_types and rehash; the 3 destructor/allocator tests are
  `crate-skip`). Contents: RawTable / RawTableInner (insert, find, erase with tombstones,
  reserve_rehash → resize or rehash_in_place, shrink_to, clear, clone), RawIter / RawIterRange,
  FullBucketsIndices, capacity_to_buckets, bucket_mask_to_capacity, TableLayout and ProbeSeq.
- `src/vendor/hashbrown/{map,set,lib}.ts`: the HashMap / HashSet operations rustc uses (insert,
  remove, get, contains, reserve, shrink_to(_fit), clear, retain, extend, from_iter, clone, Debug).
- `src/rust_ts/hash_map.oracle.test.ts`, `src/rust_ts/hash_map_oracle/{scripts.ts,fx_order.txt}`.
- `tools/probes/fxorder/{Cargo.toml.in,main.rs}`: a rustc-dev probe. It runs scripts against
  `rustc_data_structures::fx::{FxHashMap,FxHashSet}` with u32 / String / Symbol / u8 keys and prints
  capacity plus iteration order at checkpoints.

Changed:
- `src/rust_ts/hash_map.ts`: rewritten.
  - **`FxHashMap<K,V> extends Map`** and **`FxHashSet<T> extends Set`**. Every mutation also
    drives the vendored table. `for..of`, `keys`, `values`, `entries` and `forEach` follow rustc's
    order; `get`, `has` and `size` are unchanged.
  - Rust-style methods: `default`, `with_capacity`, `from_iter(iter, size_hint_lower, ..)`,
    `extend`, `reserve`, `shrink_to(_fit)`, `retain`, `clone`, `capacity`.
  - Key adapters (`KeyType` = `Hash` impl + layout): `u8_key`, `u32_key` (also used for Symbol and
    every `newtype_index!`, whose `Hash` is `as_u32().hash()`), `usize_key`, `String_key`, `str_key`.
  - Value layouts: `LAYOUT_*` constants and `pair_layout`.
  - `debug_HashMap`: exact for FxHashMap. A plain `Map` with 2+ entries still calls
    `unported(...)`, with the same message as before.
  - New `debug_HashSet`, `clone_HashMap` and `clone_HashSet`.
- **Outside my assignment, but needed for item 5:**
  - `src/rustc_ast/format.ts`: `FormatArguments::new` now builds `names` with
    `FxHashMap.default(u32_key, LAYOUT_USIZE)`. This is a one-line change plus the import.
  - `src/rustc_attr_parsing/attributes/doc.ts`: `cfg_names` is now `FxHashSet.default(u32_key)`.
    The `unported` call and its header note are removed.
- `src/rustc_builtin_macros/format.test.ts`: `PENDING` is now `{}`.
  `src/rustc_attr_parsing/attr_oracle_c.test.ts`: `AFTER_D` is now `{}`.

## Oracle
- `bun scripts/probes.ts build fxorder`, then
  `bun src/rust_ts/hash_map_oracle/scripts.ts gen|fixture <seed> <n>`.
- **Script generator.** It covers:
  - small and large tables, and growth through many resizes;
  - removals and tombstones;
  - fill → drain → refill, which forces `rehash_in_place` (about 100 per 3000 scripts);
  - steady-state churn;
  - reserve / shrink_to / shrink_to_fit / clear / clone / retain;
  - `extend` with an exact or zero size hint, `collect`, and `with_capacity`;
  - keys whose low bits are equal;
  - predefined and fresh symbols, multibyte strings, the empty string, and u8 sets (minimum-table edge case).
- **Fixture.** `fx_order.txt` holds 16-hex SHA-256 prefixes (102 KB) of the probe's answers to
  `gen(1, 6000)`. The scripts themselves are ~15 MB, so they are regenerated deterministically
  rather than stored (the header documents this).
  - The test always replays the fixture.
  - It also checks 2×2000 scripts (seeds 2 and 3) live against the probe. That part is a visible
    skip when the probe is missing, and a failure under `RUST_TS_REQUIRE_PROBES=1`.
- Results: seeds 1, 2, 3, 7, 11–15, 21, 31 and 32 (≈20k scripts) all match. Replay takes about
  1.1 s per 3000 scripts.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 2861 pass, 1 skip, 0 fail. The
  skip was already there and is unrelated (`test_span_followed_by_skips_whitespace` /
  `read_binary_file_handles_lying_stat`). format.test.ts is 102/102 and attr_oracle_c is 49/49.
- `bun scripts/coverage.ts --check`: `markers ok (5870; vendor 2603)`. This needs the two
  scope.json entries below; I tested with a temporary copy and did not commit it. Without them
  it reports "names no harness/scope.json vendor crate" errors for the new markers.
- Coverage:
  - rustc-hash-2.1.1: 33/33 (lib 22/22, random_state 6/6 skips, seeded_state 5/5).
  - hashbrown-0.17.1: 167/1073. By file: raw.rs 93/172, map.rs 29/291, set.rs 20/157; control/
    tag, bitmask and group/neon are complete. Not ported: other groups (sse2/lsx/generic), table.rs,
    raw_entry.rs, rustc_entry.rs, rayon/serde, Entry APIs, drain/extract_if, set algebra, and the
    Bucket pointer helpers. None of these affects placement for the operations ported.
- `--suite parse --sample 300` (run 20261013-102248-hashbrown-order-4kx4): 299 MATCH, 0 DIFF/UNPORTED/CRASH,
  1 ORACLE_TIMEOUT. That case is `tests/ui/expr/if/expr-stack-overflow.rs`: the oracle times out
  and the port ICEs on stack depth. It is unrelated to hash maps and not in the protected
  baseline.

## Root: needed outside this lane
1. `harness/scope.json` `vendor`: add `"rustc-hash": "=2.1.1"` and `"hashbrown": "=0.17.1"`.
2. `tools/codegen/typemap.ast.json` (FxHashMap entry):
   - change `clone` to `clone_HashMap($v, $c0, $c1)` (exported by hash_map.ts). Generated clones
     of an FxHashMap then keep their buckets; the current `new Map(...)` clone makes a plain `Map`,
     whose `{:?}` with 2+ entries is unported again.
   - update the note "Debug is exact for <= 1 entry": it is now exact for every FxHashMap.
   - `typemap.errors.json`: FxHashSet/HashSet can use `debug_HashSet($v, $f, $d0)` and
     `clone_HashSet`.
3. Gate hosts must build the new probe (`bun scripts/probes.ts build fxorder`) for the live test.
4. The integrator should review the two cross-file edits (format.ts, doc.ts).

## Not done / follow-ups
- **mbe `NamedMatches`** (`MacroRulesIdentMap`, keyed by name + ctxt) still iterates in
  insertion order. Its key `Hash` is `Ident::hash` = `write_u32(name)` then
  `write_u32(span.ctxt())`. It could become an `FxHashMap` with a `KeyType` hashing both, once its
  key is a JS primitive (e.g. a packed number).
- `Span`, `DefId`, `HirId` and other composite keys have no `KeyType`.
- Plain `Map`s used for other Fx maps are unchanged: they still print in insertion order, and
  `debug_HashMap` stays unported for them when they have 2+ entries. Each one needs its creation
  site switched to `FxHashMap` with the right key and value layouts.

## unported(...) left
- `src/rust_ts/hash_map.ts` `debug_HashMap`: "std::collections::HashMap Debug iteration order
  (hashbrown + FxHasher)", for a plain `Map` (not an FxHashMap) with 2+ entries.
- `src/rust_ts/hash_map.ts` `debug_HashSet`: "std::collections::HashSet Debug iteration order
  (hashbrown + FxHasher)", same condition for a plain `Set`.

## PORT decisions (main ones)
- hashbrown memory layout: `RawTableInner` owns `ctrl: Uint8Array` and `data: unknown[]`.
  `Bucket` and control pointers are indices; byte copies and swaps become slot copies and swaps.
- Integers:
  - Hashes and BitMask words are `bigint` u64.
  - Indices are `number`, with tables asserted ≤ 2^30 buckets so 32-bit `&` masking is exact.
  - `h1` keeps the low 32 bits.
- Allocator: the `Global` allocator returns exactly `layout.size()`, so the over-sized
  allocation branch is never taken (it is ported anyway). Allocation failure panics.
- No destructors: `NEEDS_DROP` is false, and unwind-only scope guards became catch-and-rethrow.
- NEON intrinsics are lane-wise loops over a `Uint8Array(8)`. `Tag` is a number with a
  companion const. The `TrivialClone` `clone_from_spec` specialization is merged into the generic
  one (identical result).
- Generics: `K: Hash` is a `HashFn<K>`, `K: Eq` is `===`, and `TableLayout` is passed explicitly.
  `extend` / `from_iter` take `size_hint_lower`, since upstream's reserve reads it.
- rustc-hash: only the 64-bit `cfg` arms are ported. FxHasher implements the
  rustc-stable-hash `Hasher` stand-in (u64 is `bigint`).
- Every PORT note is in the file headers and inline (`grep -rn "PORT:"` over the files above).
