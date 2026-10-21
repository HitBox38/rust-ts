# Handoff: index-ds (M4, wave 21 foundations)

Branch `lane/index-ds`, base `970d2365`. No baselines, oracle outputs, suites, `harness/` or `scripts/` touched.

## Files

- `src/rustc_index/bit_set.ts`: whole file, plan-m4 D6 word switch (see below). New: `ChunkedBitSet`, `Chunk`,
  `ChunkedBitIter`, `ChunkIter`, `MixedBitSet` (+ `MixedBitIter`), `GrowableBitSet`, `SparseBitMatrix`, the rest of
  `DenseBitSet` (`insert_range`, `contains_any`, `last_set_in`, `first_set_at_or_after`, `union_not`, `superset`,
  `to_string`, `clone_from`, ...), `would_modify_words`, `max_bit`, chunk helpers; `_eq` / `debug_*` / `hash_*` helpers.
- `src/rustc_index/{interval,idx,vec}.ts` (new), `slice.ts` (rest).
- `src/rustc_index/decodable.gen.ts`: regenerated (`bun tools/codegen/types.ts rustc_index`).
- `tools/codegen/types.sets.json` (set `rustc_index`: `decodable_construct` is now `DenseBitSet.from_u64_words($0, $1)`,
  + note) and `tools/codegen/serialize.json` (note of `rustc_index::bit_set::Word` only). Config only, no generator code.
- `src/rustc_data_structures/stable_hash.ts`: `stable_hash_DenseBitSet` / `stable_hash_BitMatrix` were `unported`; now
  `Hash::hash(self, hasher)` through `hash_DenseBitSet` / `hash_BitMatrix`.
- `src/rustc_data_structures/`: `graph/dominators/mod.ts` (new; `graph/mod.ts` exports it), `union_find.ts`,
  `frozen.ts` (new), `sorted_map.ts` (rest; `Bound`/`RangeBounds`/`range` re-exported from rustc_index/idx.ts).
- Tests: `rustc_index/bit_set/tests.test.ts` (whole upstream file), `interval/tests.test.ts`, `vec/tests.test.ts`,
  `rustc_index/bit_set.oracle.test.ts` (+ fixture `bit_set_oracle.json`, probe `bit_set_probe/{main.rs,Cargo.toml.in}`),
  `rustc_data_structures/{graph/dominators,union_find,sorted_map}/tests.test.ts`, `stable_hash/tests.test.ts`
  (`test_hash_bit_set`, `test_hash_bit_matrix` were rustc-skip; now ported).

## D6: where u64 words are observable (all made identical to upstream)

| Site | How |
|---|---|
| `#[derive(Hash)]` `DenseBitSet` (and so `StableHash`) | `hash_DenseBitSet`: `write_usize(domain)`, `write_length_prefix(#u64 words)`, one `write` of the u64 words' LE bytes (odd u32 tail padded with a zero high half) |
| `#[derive(Hash)]` `BitMatrix` (and `StableHash`) | `hash_BitMatrix`: same, rows padded to whole u64 words |
| `ToString for DenseBitSet` | walks u64 words (8 bytes per `|` group) |
| `#[derive(Debug)]` `GrowableBitSet` | prints u64 words (`words_to_u64`); `PhantomData<T>` needs the type name (`type_name_T`) |
| `#[derive(PartialEq)]` `GrowableBitSet` | compares u64 word vectors (`GrowableBitSet_eq`) |
| `#[derive(Debug)]` `Chunk` (private upstream; tests) | `debug_Chunk` prints 32 u64 words |
| `Decodable DenseBitSet` (crate metadata) | `DenseBitSet.from_u64_words` splits the decoded u64 words |
| `Decodable BitMatrix` (not decoded yet) | `BitMatrix.from_u64_words` ready for the generator |
| `BitMatrix::words()` | returns u32 words; no caller outside bit_set.rs upstream |
| `count()`, `Mixed.ones_count`, iteration, element `Debug`, `changed` results, `CHUNK_BITS`, `MixedBitSet` threshold | independent of word width (CHUNK_WORDS doubled to 64) |
| `would_modify_words` `SUBCHUNK_LEN` | 16 u32 = 8 u64 (only early-exit points) |

Proof: `bit_set.oracle.test.ts` replays `bitsetprobe` (rustc-dev probe linking the pinned rustc_index /
rustc_data_structures / rustc_serialize; built by hand as in its Cargo.toml.in): 100 `DenseBitSet`s (StableHash
Hash128, FxHasher `Hash`, `to_string`, `{:?}`, opaque-encoded `DenseBitSet<u32>` decoded by `decode_DenseBitSet`), 33
`BitMatrix`es (Hash128, Fx, `{:?}`), 12 `GrowableBitSet` `{:?}`, 28 Chunked/Mixed sets, `IntervalSet` and
`SparseBitMatrix` `{:?}` — all equal. Plus a model test: the hasher call sequence equals `[u64]::hash` of
independently-computed bigint words. Mutation check: changing the length prefix or the `to_string` grouping fails it.
Upstream's `chunked_bitset` test compares the `Mixed` chunk words with upstream's u64 literals.

`Rc<[Word; CHUNK_WORDS]>`: a `Uint32Array` marked "maybe shared" in a `WeakSet` on `Chunk::clone`; `rc_make_mut`
copies a marked array before writing (Rc::make_mut's observable behaviour; at most one extra copy per holder).

Micro-benchmark (2000-bit `DenseBitSet`, machine loaded): `iter` 20-40x faster than the bigint version; `contains`
about equal (dominated by the `assert!` and the `[index, mask]` tuple of `word_index_and_mask`).

## Coverage (`bun scripts/coverage.ts --missing`)

bit_set.rs 117/117, interval.rs 32/32, idx.rs 20/20, vec.rs 44/44, slice.rs 29/29; bit_set/tests.rs 31/31,
interval/tests.rs 10/10, vec/tests.rs 5/5 (1 rustc-skip), stable_hash/tests.rs 11/11; dominators/mod.rs 11/11 (+ tests
5/5), union_find.rs 4/4 (+ tests 2/2), frozen.rs 2/2, sorted_map.rs 28/28 (+ tests 14/14). `work_queue.rs` does not
exist at the pin. `coverage.ts --check`: markers ok.

## Checks

- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5453 pass, 1 skip, 0 fail (368 files).
- Samples (`RUST_TS_AGENT=index-ds`, run ids `idxds-{base,lane}-<suite>`), compared case by case (status + unported
  reason) with the same samples on base `970d2365`:

| suite | sample | MATCH / DIFF / UNPORTED / TIMEOUT | differing cases vs base |
|---|---|---|---|
| tydump-ui | 300 | 254 / 0 / 45 / 1 (subsets typeck+traits 241/0/39/1, rustc_dump 14/0/8) | 0 |
| tydump-minicore | 46 (all) | 45 / 0 / 1 / 0 | 0 |
| tydump-nocore | 300, `--seed m17` | 292 / 0 / 8 / 0 | 0 |
| hir-tree | 300 | 299 / 0 / 1 / 0 | 0 |
| resdump | 300 | 299 / 0 / 1 / 0 | 0 |
| expanded | 300 | 299 / 0 / 1 / 0 | 0 |

The one tydump-ui TIMEOUT is the same case on base and lane (machine loaded by other lanes).

## unported(...) left

None in this lane's files. (`stable_hash_DenseBitSet` / `stable_hash_BitMatrix` lost theirs.)

## PORT decisions (recorded with `state.ts record decision`)

- D6 implementation as above.
- `std::ops::{Bound, RangeBounds}` + range constructors (`range`, `range_inclusive`, `range_from`, `range_to`,
  `range_to_inclusive`, `range_full`, `range_contains`, `range_iter`) live in `rustc_index/idx.ts` until a
  `src/std/ops.ts` exists (root: move them there).
- `Idx` is a function table (`Idx<I>`, `Idx_usize`, `Idx_u32`, `Idx_provided`); `IntoSliceIdx` impls are identity
  entries on a companion const.
- `IndexVec` / `IndexSlice` methods are companion consts over `T[]`; `&mut T` results are the element itself; `T: Clone`
  arguments take an optional `clone_T` (omit only for immutable `T`); range sub-slices are copies; `drain` is eager.
- `MixedBitSet` is a `$`-tagged union with methods on the companion const; `MixedBitIter` a class wrapping the variant.
- `IntervalSet` pairs are owned tuples (clone copies them); u32 `+ 1` wraps (`u32_inc`).
- Derived `Debug` of `GrowableBitSet` / `IntervalSet` takes `type_name_T` for `PhantomData<T>`.
- dominators (fork): `PreorderIndex` via `newtype_index`; `eval` -> `eval_`; manual `next()` in the DFS so
  `continue 'recurse` keeps the iterator. sorted_map: `get_mut`-style returns are the value; `V: Default` is a thunk;
  `offset_keys` takes a `MutRef<K>` callback; `from_iter` sorts with std's ported sort (inputs > 20 stop at
  `slice_sort` unported ipnsort). `Frozen<T>` is `T`.
- `vec/tests.rs::index_size_is_optimized` rustc-skip (niche layout); bit_set `#[bench]`es run their body as tests.

## For root

- `tools/codegen` config edits above (types.sets.json `rustc_index`, serialize.json note) need the usual review.
- The probe can move to `tools/probes/bitsetprobe` unchanged.
