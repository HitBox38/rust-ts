# Handoff: abi-layout-a (layout fill lane 3 of 5)

Branch `lane/abi-layout-a` (base `6a5519cc` = lane/layout-contract, no merges). This is row 3 of the split table in
`docs/handoff/layout-contract.md`: rustc_abi `layout.rs:1..582` + `:1090..1537` and `layout/simple.rs`.

## Result
All 19 stubs are filled, in place, in upstream order. Markers: `// rustc:`.
- `src/rustc_abi/layout.ts`: `absent`, `LayoutCalculatorError::{without_payload, fallback_fmt}`, `LayoutCalculator::{layout_of_array_like,
  layout_of_scalable_vector_type, layout_of_simd_type, layout_of_univariant, layout_of_struct_or_enum, layout_of_union,
  layout_of_struct, layout_of_univariant_biased, format_field_niches}`, `vector_type_layout`. A few local integer helpers
  sit at the end of the module (`u64_trailing_zeros`, `u128_ilog2`, tuple-key comparators, `Option_Align_max`, `Size_max`).
- `src/rustc_abi/lib.ts` (only the simple.rs statics in the `LayoutData` body, plus 2 lines of imports): `LayoutData::{unit, never_type,
  scalar, scalar_pair, uninhabited_variant, for_variant}`. Two helpers, `u64_wrapping_add` and `u64_rotate_right`, sit right after the
  class. The imports changed so that `Hash64` and `FieldIdx` / `VariantIdx` (from layout.ts) are value imports. This is safe for init
  order because they are only used inside function bodies.
- `src/rustc_ty_utils/layout_contract.test.ts`: the stub count went from 168 to 149, and two checks were re-pinned (see below).

**Checked against the oracle.** A scratch script (not committed) replaced abi-lib's stubs with direct ports of their upstream bodies:
`Primitive`/`Scalar` size, align and valid_range, `Niche::{from_scalar, available}`, `LayoutData::is_*`, `BackendRepr::{to_union,
scalar_platform_align}` and `Size::add`. It then built these layouts with this lane's code:
- 13 tuples, including niche-bias / alt-layout cases (`(bool, u32)`, `((u8, u8, u8, bool), (u8, bool, u8))`, `(u8, [u8; 16], bool)`,
  `(char, u8, bool)`, ...);
- the structs repr(Rust), repr(C), repr(packed), repr(transparent) and repr(align(8));
- `UnsafeCell<(bool, char)>` (niches disabled), a univariant enum, two unions and `[bool; 3]`.

Each one's `{:#?}` was compared with `rustc +nightly-2026-10-11 -Zdump-layout` (`#[rustc_dump_layout(debug)]`). **All 21 are
byte-identical**, randomization seeds included for the tuples and arrays (ADT seeds depend on the def-path hash, so they were
normalized). This covers field reordering (stable `sort_by_key`, the `(Reverse(group), niche key, offset key)` tuple keys), both niche
biases, the end-biased retry, the Scalar / ScalarPair ABI selection, the union ABI forwarding and the simple.rs seeds. The script is
worth turning into an oracle test once abi-lib's helpers land.

## PORT decisions
- `sort_by_key` (stable) is `Array.prototype.sort` (stable since ES2019) with a lexicographic tuple comparator. The `u128` / `u64`
  parts are `bigint`s (`!niche_size` is `U128_MAX ^ x`, `!(..)` of the u64 end offset is `U64_MAX ^ x`), and `cmp::Reverse(group)` is
  compared reversed. `optimizing = &mut in_memory_order.raw[..end]` is sorted as a copy and then written back.
- Lazy iterators keep their laziness: `present_variants` in `layout_of_struct_or_enum` calls `absent` only until two present variants
  are found, and `non_zst_fields` in `univariant_biased` calls `is_zst` only until a third non-ZST field is found.
- `fields.len() - 1` for `MaybeUnsized` with no fields panics with core's slice message (usize wrap, then the slice index fails), as
  upstream does.
- `cfg!(feature = "randomize")` is true (a default feature of rustc_abi). The `-Zrandomize-layout` shuffle is `unported` (below).
- `layout_of_struct`'s `hide_niches(&mut Scalar)` uses a `MutRef<Scalar>`. A Scalar in `st.backend_repr` may be shared with a field's
  frozen interned layout (a Rust copy), so the fresh Scalar is written back into a fresh `BackendRepr`.
- `niche.offset += offset` on the immutable `Niche` builds a new `Niche`, using `Size::add_assign`.
- `struct AbiMismatch` (a unit struct) is `null`, so the union's `Result<Option<(BackendRepr, Align)>, AbiMismatch>` is
  `Result<[BackendRepr, Align] | undefined, null>`.
- `assert_eq!(.., "non-Aggregate ...")` builds core's message (with the custom text) only on failure. The `assert_eq!` on the scalar
  pair's `in_memory_order` uses `std/panic.ts assert_eq`.
- In `scalar_pair`, `max_by_key` over `from_scalar(b)` then `from_scalar(a)` evaluates both `from_scalar` calls first (they are the
  `chain` argument), and a tie keeps the later niche.
- simple.rs seeds: the `u64` `wrapping_add` / `rotate_right` arithmetic is done in `bigint`, and `range.start as u64` is `& U64_MAX`.

## `unported(...)` left (3, none on a normal path)
1. `layout_of_array_like`: `Size beyond 2^53 (...)`. It is reached only when the count is above 2^53, the element is not a ZST and the
   product is below `obj_size_bound`. Otherwise the result is exact: `0 * n` is 0, and a product of at least `obj_size_bound` is
   `SizeOverflow`, as upstream.
2. `layout_of_univariant`: `.expect("alt layout should always work")` would have to format the error's generic `F: Debug` payload.
   It is unreachable, because the end-biased run fails only where the start-biased run already failed.
3. `layout_of_univariant_biased`: the `-Zrandomize-layout` shuffle (`rand_xoshiro::Xoshiro128StarStar` + `SliceRandom::shuffle`,
   vendor crates that are not ported).

## `Size` sites (root decision: `Size` stays a `number`)
These sites rely on abi-lib's checked `Size` helpers. Today `Size.checked_add` / `checked_mul` / `align_to` convert with
`Number(bigint)` and would round silently past 2^53, so **abi-lib should make them stop as UNPORTED past `MAX_SAFE_INTEGER`**:
- `layout_of_array_like`: `element.size.checked_mul(Number(count), cx)`. There is a local check for counts above 2^53 (item 1 above).
- `layout_of_univariant_biased`: `prefix_size.align_to`, `offset.align_to`, `niche.offset.add_assign(offset)`,
  `offset.checked_add(field.size, dl)`, `min_size.align_to(align)`.
- `layout_of_union`: `size.align_to(align)`.
- `scalar_pair`: `a.size(dl).align_to(b_align)`, `b_offset.add(b.size(dl)).align_to(align)`.
- `vector_type_layout`: `elt.size.checked_mul(Number(count.as_u64()))` (the count is at most 2^15), `size.checked_mul(number_of_vectors)`,
  `size.align_to(align)`.
- `layout_of_univariant`: `layout.size.bytes() - head_space - niche_len`. This is bounded by the size and cannot go wrong.

## Dependencies (stubs of other lanes that this code calls)
- abi-lib: `LayoutData::{is_uninhabited, is_1zst, is_unsized, is_zst}`, `BackendRepr::{to_union, scalar_platform_align}`,
  `Scalar::{primitive, size, default_align, valid_range}`, `Primitive::size`, `Niche::{from_scalar, available}`, `Size::{add, add_assign}`,
  `BackendLaneCount::{new, as_u64, is_power_of_two}`, and `FieldsShape::{index_by_increasing_offset, offset}` (only for
  `format_field_niches`, which is used only by `debug!`).
- abi-layout-b: `layout_of_enum` (called by `layout_of_struct_or_enum` for multi-variant enums).
- ty-utils-layout: `layout_of_uncached` is still the first stop of every layout.

## Re-pinned contract checks (no assertion weakened)
- `LayoutData.scalar(..)` now stops at its first call, `rustc_abi::Niche::from_scalar` (abi-lib), instead of its own stub.
- `layout_of_union(null, [])` used to stop at the stub. It now runs: with a real `TargetDataLayout::default()`, a default `ReprOptions`
  and an empty field list, it returns `Err(EmptyUnion)`. A new stop check pins the remaining layout.rs stub,
  `LayoutCalculator::layout_of_enum` (abi-layout-b). Re-pin it when that lane lands.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (17062; vendor 3888).
- Coverage: rustc_abi layout.rs 14/16 (was 1; the 2 left are abi-layout-b's), layout/simple.rs 6/6 (was 0); rustc_abi 157/273
  (was 138); TOTAL 16543/25518.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_abi src/rustc_ty_utils`: 28 pass, 0 fail (contract test included).
- Samples. The base was a temporary detached worktree at `6a5519cc` (now removed). Both sides used `RUST_TS_AGENT=abi-layout-a`, so
  the samples are the same:

| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-103954-abi-layout-a-sw04` | 41 / 0 / 5 / 0 | `20261021-104438-abi-layout-a-gr35` | 41 / 0 / 5 / 0 |
| thirdump-minicore (46) | `20261021-104022-abi-layout-a-0ymz` | 41 / 0 / 5 / 0 | `20261021-104504-abi-layout-a-cio9` | 41 / 0 / 5 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-104055-abi-layout-a-7z3m` | 290 / 0 / 10 / 0 | `20261021-104531-abi-layout-a-u8bh` | 290 / 0 / 10 / 0 |
| hir-tree `--sample 300` | `20261021-104248-abi-layout-a-ge6e` | 299 / 0 / 1 / 0 | `20261021-104750-abi-layout-a-2fjx` | 299 / 0 / 1 / 0 |

There is no new DIFF, and the per-case statuses and stop messages are identical. The three layout cases (`mini_core.rs`,
`issue-87573.rs`, `no-core-edition2018-syntax.rs`) still stop at `rustc_ty_utils::layout::layout_of_uncached` (ty-utils-layout), which
runs before any of this lane's code. Once lanes 1 and 2 land, the first primitive / struct layouts go through `LayoutData::scalar` /
`layout_of_struct` → `layout_of_univariant` here.
