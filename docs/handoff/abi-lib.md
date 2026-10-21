# Handoff: abi-lib (layout fill lane 2 of 5)

Branch `lane/abi-lib` (base `6a5519cc` = lane/layout-contract). Row 2 of the split table in `docs/handoff/layout-contract.md`.

## Files touched
- `src/rustc_abi/lib.ts`: `BackendLaneCount` (4), `TargetDataLayoutError::into_diag`, `Size` ops (`add`, `sub`, both `mul`s,
  `add_assign`, nested `bits::overflow`) and the exactness rewrite of the already-ported `from_bits` / `from_bytes` / `bits` /
  `align_to` / `checked_add` / `checked_mul`, `Step for Size` (9), `Float::align`, `Numeric` (2), `Primitive` (2), `Scalar`
  (10), `FieldsShape` (3), `NumScalableVectors` (2 + `into_diag_arg`), `BackendRepr` (10), `Niche` (3), `LayoutData` (12),
  `VariantLayout` (3).
- `src/rustc_abi/wrapping_range.ts`: the 9 remaining fns.
- `src/rustc_abi/callconv.ts`: `HomogeneousAggregate::{unit, merge}`; re-exports `Reg_eq`, `RegKind_eq`.
- `src/rustc_abi/callconv/reg.ts`: `RegKind::from_primitive`, `Reg::{opaque_vector, align}`, the `reg_ctor!` statics
  (`Reg.i8()` .. `Reg.f128()`), `RegKind_eq` / `Reg_eq` (derived `PartialEq`), upstream doc comments.
- `src/rustc_abi/layout/ty.ts` (owned by abi-layout-b; only the `homogeneous_aggregate` stub, callconv.rs:69, which the
  contract assigned to this lane, plus its imports and a `size_max` helper): **expect a merge overlap in the import block**.
- `src/rustc_ty_utils/layout_contract.test.ts`: stub count 168 -> 84; the runtime checks that named this lane's stubs
  (`LayoutData::is_zst`, `BackendRepr::is_unsized`, `Scalar::primitive`, `WrappingRange::contains`, the forwarded
  `TyAndLayout::is_1zst`) now assert the real values (no assertion weakened: each checked a stub stop that no longer exists).
- Tests: `src/rustc_abi/tests.test.ts` (all of upstream tests.rs now: + the 3 `WrappingRange` tests, + the
  `smallest_range_containing` doc example), new `src/rustc_abi/abi_lib.test.ts` (7 tests).

## Coverage
- `bun scripts/coverage.ts --missing`: rustc_abi lib.rs 157/157 (was 88), wrapping_range.rs 12/12 (was 3), callconv.rs 3/3
  (was 0), callconv/reg.rs 3/3 (was 0), tests.rs 5/5 (was 1). rustc_abi 227/273 (was 138); TOTAL 16613/25518 (was 16524).
- `bun scripts/coverage.ts --check`: markers ok.

## `Size` beyond 2^53 (root decision; for the other fill lanes)
`Size` stays a plain `number` (`Size.raw`). All arithmetic is exact (`bigint` inside), and the only ways out are:
- `size_raw(v: bigint)` (private): a byte or bit count as a `number`; beyond `Number.MAX_SAFE_INTEGER` it calls
  `unported(SIZE_BEYOND_2_53)`, where `SIZE_BEYOND_2_53 = "rustc_abi::Size beyond 2^53 (Size.raw is a JS number)"` (exported).
- `u64_arg(v: number | bigint)` (private): an `impl TryInto<u64>` / `u64` argument. A `number` that is not a safe integer
  is `unported` (the caller may already have rounded it); outside `0..=u64::MAX` it panics like upstream's `unwrap`.

What that means per op:
- `Size.from_bytes(n | bigint)`, `Size.from_bits(n | bigint)`: accept `bigint` (signature widened; old `number` callers
  unchanged; fast path for safe non-negative integers). Beyond 2^53 - 1 bytes: UNPORTED.
- `size.bits()`: a bit count beyond 2^53 - 1 (bytes >= 2^50) is UNPORTED; the upstream `overflow` panic (> u64) is kept.
- `checked_add(offset, cx)`, `checked_mul(count: number | bigint, cx)`: upstream's `None` is exact for every result
  >= `obj_size_bound` (a power of two: 2^15 / 2^31 / 2^61) or > `u64::MAX`; a result below the bound but beyond 2^53 - 1 is
  UNPORTED. **Pass array counts as `bigint`** (`checked_mul(count, cx)`, not `Number(count)`): `[(); usize::MAX]` gives
  `Some(0)` and `[u8; usize::MAX]` gives `None` without any precision question.
- `add` / `add_assign` / `sub` / `mul(count: number | bigint)` / `Size.u64_mul(count, size)`: upstream panics kept (u64
  overflow, negative `sub`), otherwise exact or UNPORTED.
- `align_to`: exact; a result beyond 2^53 - 1 is UNPORTED.
- `Step_Size`: `usize` counts must be safe integers; wrapping results beyond 2^53 (e.g. `backward(2, 3)`) are UNPORTED.
- `FieldsShape::count` of an `Array` with `count > 2^53 - 1` is UNPORTED (`rustc_abi::FieldsShape::count (array length
  beyond 2^53)`); `FieldsShape::offset` of an `Array` multiplies by a `bigint` index.
abi-layout-a's call sites (its handoff, "These sites rely on abi-lib's checked `Size` helpers") are all covered by this:
none of them can round any more. Its `checked_mul(Number(count), cx)` calls may pass the `bigint` count directly now.

## `// PORT:` decisions
- `TargetDataLayoutError_into_diag(self, dcx, level): Diag` (the stub's `(e) => never` signature fixed to the trait method's).
  Its callers keep their stand-ins (not this lane's files): rustc_session `config/cfg.ts:539`, rustc_middle
  `ty/context.ts:2939` can now call it.
- `Size`: the helpers above; `checked_*` / ops / `Step` in `bigint`; `u64::forward` / `backward` wrap (rustc is built
  without overflow checks, `#[rustc_inherit_overflow_checks]`).
- `BackendLaneCount::new`: `u16::try_from(count)` + the `..=MAX_SIMD_LANES` pattern as one range test on the `bigint`.
- `FieldsShape::offset` / `index_by_increasing_offset`: `IndexVec` indexing panics out of bounds (explicit check).
- `index_by_increasing_offset` returns an array (contract: `impl ExactSizeIterator`).
- `WrappingRange::with_start` / `with_end` return a new value (contract: immutable `Copy` value).
- `smallest_range_containing`: `reduce` / `sort_unstable` / `array_windows` / `min_by_key` written out (first minimum wins).
- `Reg`'s `reg_ctor!` constructors: written-out statics with `// reg_ctor!(..)` comments (no coverage entries).
- `homogeneous_aggregate`: the `from_fields_at` closure is an arrow fn; `Ord::max` of `Size` is the local `size_max`
  (second on a tie); `assert_ne!` is inlined with Rust's message.

## `unported(...)` left
- `SIZE_BEYOND_2_53` (see above) and `rustc_abi::FieldsShape::count (array length beyond 2^53)`. No stubs left in this
  lane's files (84 remain in the scope, all other lanes').

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: ok.
- Every touched module loads as a fresh entry (rustc_abi lib / layout / layout/ty / layout/coroutine / wrapping_range /
  callconv / callconv/reg, rustc_middle ty/layout, rustc_ty_utils lib). (rustc_target `spec/mod.ts` fails as a fresh entry
  at base too: `Os` TDZ in spec/json.ts, unrelated.)
- `bun test src/rustc_abi`: 24 pass. `layout_contract.test.ts`: 5 pass.
- Unit-test sources: upstream tests.rs and the wrapping_range.rs doc test (verbatim values); `Niche::reserve` against
  rustc's own `#[rustc_layout(debug)]` output in tests/ui (`Option<bool>`, `Option<char>` debug.stderr:609,
  `Option<NonZero<u32>>` range_patterns.stderr:163, `Result<[u32; 0], Packed<U16IsZero>>` zero-sized-array-enum-niche.stderr:265,
  `NicheFirst` issue-96158-scalarpair-payload-might-be-uninit.stderr:247).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_abi src/rustc_ty_utils src/rustc_target src/rustc_middle src/rustc_session
  src/rustc_hir_analysis --timeout=120000`: 619 pass, 4 fail. The same 4 fail at base `6a5519cc` (checked in the base
  worktree): rustc_hir_analysis `compare_impl_item.oracle` (e0053_sig, e0326), `wfcheck_a` (field_bound.rs), `wfcheck_b`
  (static_wf.rs). These are the wave-19 merge fallout the layout-contract handoff already lists, in no file this lane touched.

## Samples
Lane vs base (base = a temporary detached worktree at `6a5519cc`, removed afterwards). Both sides ran with
`RUST_TS_AGENT=abi-lib`, so they used the same samples.

| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-105324-abi-lib-8edr` | 41 / 0 / 5 / 0 | `20261021-105903-abi-lib-d5zv` | 41 / 0 / 5 / 0 |
| thirdump-minicore (46) | `20261021-105358-abi-lib-kb4t` | 41 / 0 / 5 / 0 | `20261021-105939-abi-lib-bzqp` | 41 / 0 / 5 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-105421-abi-lib-dwvr` | 290 / 0 / 10 / 0 | `20261021-110017-abi-lib-musp` | 290 / 0 / 10 / 0 |
| hir-tree `--sample 300` | `20261021-105647-abi-lib-7lvx` | 300 / 0 / 0 / 0 | `20261021-110346-abi-lib-d6l9` | 300 / 0 / 0 / 0 |

No new DIFF; statuses and UNPORTED stop paths are identical on both sides. The layout stops are still
`rustc_ty_utils::layout::layout_of_uncached` (lane ty-utils-layout), which runs before any of this lane's code. These
fns are reached once lanes 1 and 3 land.

## For root
1. Record the `Size` rule as implemented (section above): exact `bigint` arithmetic, and `unported(SIZE_BEYOND_2_53)` for
   any value past 2^53 - 1. `from_bytes` / `from_bits` / `checked_mul` / `mul` / `u64_mul` now also take `bigint` (these
   are root-owned declarations, widened and backward-compatible).
2. Merge overlaps to expect: `layout/ty.ts` import block (abi-layout-b), `lib.ts` import lines (abi-layout-a added value
   imports of `Hash64` / `FieldIdx` / `VariantIdx`; this lane made `FieldIdx`, `LayoutCalculatorError`, `RegKind` and
   `WrappingRange` value imports), and the stub-count line of `layout_contract.test.ts`. The count drops by 84 for this lane.
3. `TargetDataLayoutError_into_diag` is real now: rustc_session `config/cfg.ts:539` and rustc_middle `ty/context.ts:2939`
   can drop their stand-ins (their owners' files).
