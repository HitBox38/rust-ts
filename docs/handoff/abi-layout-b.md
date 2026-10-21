# Handoff: abi-layout-b (layout fill lane 5 of 5): enums, coroutines, `TyAndLayout` methods, `RangeSet`

Branch `lane/abi-layout-b` (base `6a5519cc` = lane/layout-contract, no merges). Split-table row 5 of
`docs/handoff/layout-contract.md`; all 26 stubs of the row are filled.

## Files touched
- `src/rustc_abi/layout.ts`: `LayoutCalculator::layout_of_coroutine` (:244) and `layout_of_enum` (:583), in place
  (abi-layout-a's line ranges untouched). The import block changed: names that are now values (`Integer`, `LayoutData`,
  `Scalar`, `StructKind`) moved from the `import type` line into a separate value import marked `(abi-layout-b ...)`.
  **Merge note:** abi-layout-a probably edits the same import lines, so expect a conflict there. Keep both sides' names.
- `src/rustc_abi/layout/coroutine.ts`: `coroutine_saved_local_eligibility` (:42), `layout` (:139), plus a derived
  `SavedLocalEligibility_eq` (module-private).
- `src/rustc_abi/layout/ty.ts`: the 22 `impl TyAndLayout` fns (ty.rs:138..467). The `RangeSet` `unknown` alias is
  replaced by the real type.
- `src/rustc_data_structures/range_set.ts` (new): `RangeSet<T>` (`new`, `add_range`, `difference`) + derived Debug.
- Tests: `src/rustc_data_structures/range_set.test.ts` (new, 2), `src/rustc_abi/layout/coroutine.test.ts` (new, 3;
  hand-derived from upstream's algorithm), `src/rustc_ty_utils/layout_contract.test.ts` (stub count 168 -> 142; 2 re-pins, below).

## Coverage
- rustc_abi layout.rs 3/16 (was 1), layout/coroutine.rs 2/2 (was 0), layout/ty.rs 47/47 (was 25);
  rustc_data_structures range_set.rs 3/3 (was 0). rustc_abi 164/273; TOTAL 16553/25518.
- `bun scripts/coverage.ts --check`: markers ok (17072; vendor 3888). `bunx tsc --noEmit -p .`: clean.

## Tests
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_abi src/rustc_data_structures src/rustc_ty_utils src/rustc_middle/ty`:
  335 pass, 0 fail.
- Fresh entry-point loads succeed: rustc_abi lib / layout / layout/ty / layout/coroutine, range_set, and rustc_middle ty/layout.
- Contract-test re-pins (no assertion weakened):
  - `coroutine_saved_local_eligibility(0, [], null)` used to be a stop check. It is now a value check:
    `(0, [], BitMatrix.new(0, 0))` returns an empty set and no assignments.
  - `tl.field(null, 0)`: `rustc_abi::layout::ty::TyAndLayout::field` -> `rustc_middle::ty::layout::TyAbiInterface::ty_and_layout_field`.
    That is middle-layout's stub. If middle-layout ports it, re-pin at merge.

## Samples (lane vs base `6a5519cc` in a temporary detached worktree, since removed; both `RUST_TS_AGENT=abi-layout-b`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-104357-abi-layout-b-5icc` | 41 / 0 / 5 / 0 | `20261021-104917-abi-layout-b-k5lo` | 41 / 0 / 5 / 0 |
| thirdump-minicore (46) | `20261021-104418-abi-layout-b-yzf5` | 41 / 0 / 5 / 0 | `20261021-104945-abi-layout-b-147l` | 41 / 0 / 5 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-104434-abi-layout-b-m51e` | 290 / 0 / 10 / 0 | `20261021-105015-abi-layout-b-y1uh` | 290 / 0 / 10 / 0 |
| hir-tree `--sample 300` | `20261021-104647-abi-layout-b-86jv` | 297 / 0 / 3 / 0 | `20261021-105449-abi-layout-b-vaya` | 297 / 0 / 3 / 0 |

Per-case statuses and stop reasons are identical in all four suites. No new DIFF. The layout stops are still at
`layout_of_uncached` (lane ty-utils-layout), which runs before any code in this lane.

## `unported(...)` left
- In this lane's code: `Size beyond 2^53 (TyAndLayout::add_data_ranges ...)`, reached through `array_count_as_number`
  in layout/ty.ts at two sites: `elem.size * count` and the `0..count` loop. `FieldsShape::Array.count` is a `bigint`.
  Above `Number.MAX_SAFE_INTEGER`, the `number` multiplier would be wrong. These are the only `Size` sites this lane
  added. All other `Size` arithmetic goes through abi-lib's `Size` methods (`add` / `sub` / `mul` / `u64_mul` /
  `add_assign` / `align_to`).
- No stubs remain in this lane's rows. Paths reached through other lanes' stubs:
  - abi-layout-a: `absent`, `layout_of_univariant`, `LayoutData::scalar_pair`.
  - abi-lib: `VariantLayout::{from_layout, is_uninhabited, has_fields}`, `Niche::{reserve, from_scalar, available}`,
    `Primitive::{size, default_align}`, `Scalar::{primitive, size, to_union}`, `Size` ops,
    `WrappingRange::smallest_range_containing`, `FieldsShape::{count, offset, index_by_increasing_offset}`,
    `BackendRepr::is_scalar`, `LayoutData::{is_zst, is_1zst, is_uninhabited}`.
  - middle-layout: every `TyAbiInterface` table fn.

## `// PORT:` decisions
1. `RangeSet<T>`'s bounds (`Copy + Ord + Default + Add + Sub`) are a function table `RangeSetOps<T>` held by the set.
   `RangeSet::new()` becomes `RangeSet.new(ops)`; layout/ty.ts has `SIZE_RANGE_SET_OPS` (Size `Ord` = byte count).
   `partition_point` is a local binary search (its result is unique, so the strategy is not observable).
2. Upstream bug kept as is: `RangeSet::difference` pushes `(cursor, b_offset)` / `(cursor, a_end)`, i.e. *end*
   values, into a set of `(offset, size)` pairs. `variant_dependent_padding_ranges` then maps `offset..offset + size`.
   The test pins the upstream behaviour.
3. layout.ts `layout_of_enum`: local helpers for missing `Ord`s.
   - `Option<Align>` max: `None < Some`.
   - `Integer` order: declaration order I8 < .. < I128.
   - `Size` `Ord::max` returns `other` on ties; `Size` cmp uses the byte count.
   - Tie-breaks follow upstream: `max_by_key` (largest variant) keeps the last maximal element via `>=`.
     `Ord::max` / `Ord::min` follow std (`max`: other on ties; `min`: self).
   - The final choice is `(tl.size.cmp(nl.size), niche_size(tl).cmp(niche_size(nl)))`, with both sides evaluated
     eagerly as in the tuple.
   - Lazy upstream iterators with pure bodies are written as loops, keeping their short-circuit points:
     `.collect::<Option/Result>()?` stops at the first `None` / `Err`, `.all` is `every`, `.any` is `some`.
     The ScalarPair search keeps the lazy two-`next()` filter as a generator.
   - The or-pattern with a guard `(p @ Pointer, i @ Int) | (i @ Int, p @ Pointer) if ..` is one condition, because
     the two alternatives are mutually exclusive.
4. coroutine.ts writes out two functions that are not ported in rustc_index. This lane does not own rustc_index;
   root may want to port them there and repoint:
   - `DenseBitSet::insert_all` (bit_set.rs:210) as `words.fill(!0); clear_excess_bits()`.
   - `IndexSlice::invert_bijective_mapping` (slice.rs:185; its `debug_assert_eq!`s are off).

   It also writes out `ReprOptions::default()` (`#[derive(Default)]`, lib.rs:152). lib.ts has no `default`, so
   abi-lib may want to add one.
5. coroutine.ts `max_discr = (variant_fields.len() - 1) as u128` wraps like `usize` (`BigInt.asUintN(64, ..)`).
   `prefix_layouts` (`mut IndexVec`, passed by value) is the caller's array, mutated in place.
6. `F: Deref<Target = &LayoutData>` fields read `f.deref().<x>` (the `DerefLayoutData` interface only has `deref()`).
7. Shared `Copy` scalars: `layout_of_enum` uses one `tag` / `niche_scalar` object in both `Variants::Multiple.tag` and
   `backend_repr`, as rustc copies them. Per layout-contract decision 3, a later writer (`valid_range_mut`) must copy it first.

## For root
- Record decisions 1-7 (mainly 1, 2, 4).
- Optional follow-ups for owners:
  - rustc_index: `DenseBitSet::insert_all`, `IndexSlice::invert_bijective_mapping`.
  - abi-lib: `ReprOptions::default`, `Integer` / `Option<Align>` `Ord` helpers.
