# Handoff: ty-utils-layout (layout fill lane 1 of 5)

Branch `lane/ty-utils-layout` (base `6a5519cc` = lane/layout-contract, no merges). Row 1 of the split table in
`docs/handoff/layout-contract.md`: rustc_ty_utils `layout.rs` (rest) and `layout/invariant.rs`.

## Files touched
- `src/rustc_ty_utils/layout.ts`: `map_error`, `extract_const_value`, `layout_of_uncached` (all arms: pattern types,
  scalars, fn pointers, `!`, thin / wide pointers incl. the `Pointee::Metadata` and the struct-tail paths, arrays /
  slices / `str`, unit-like types, coroutines, closures, tuples, scalable vectors, SIMD, ADTs incl. the
  `debug_assertions` unsizing check, `F16B` / `PpcF128`, unsafe binders, the error / generic arms),
  `record_layout_for_printing`, `variant_info_for_adt`, `variant_info_for_coroutine`.
- `src/rustc_ty_utils/layout/invariant.ts`: `layout_sanity_check` with its three nested fns (`non_zst_fields`,
  `skip_newtypes`, `check_layout_abi`) nested in it, as upstream.
- `src/rustc_ty_utils/layout_contract.test.ts`: stub count 168 -> 158; the two runtime checks of my former stubs removed;
  the in-process stops re-pinned to the next stop (`u8` / `i32` / `Ty::new_array` -> `rustc_abi::Primitive::size`,
  `bool` -> `rustc_abi::layout::simple::LayoutData::scalar`). No assertion weakened.
- New `src/rustc_ty_utils/layout.test.ts` (oracle-backed, see Tests).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_ty_utils/src/layout.rs`: 9/9 ported (was 3/9).
- `bun scripts/coverage.ts --missing compiler/rustc_ty_utils/src/layout/invariant.rs`: 4/4 ported (was 0/4).
- rustc_ty_utils 92/123 (was 82); TOTAL 16534/25518 (was 16524). `coverage.ts --check`: markers ok (17053).

## Tests
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_ty_utils/`: 19 pass, 0 fail (incl. the contract test and the new test, with
  `RUST_TS_REQUIRE_PROBES=1`).
- New `layout.test.ts` (4 tests):
  1. 12 types (`u8`, `bool`, `char`, `usize`, `i32`, `f64`, `i128`, `&u8`, `*const u8`, `!`, `&str`, `*mut [u16]`)
     laid out in-process by the real `tcx.layout_of` -> `layout_of_uncached` -> `layout_sanity_check` print the same
     `{:#?}` as the pinned rustc's `#[rustc_dump_layout(debug)]` on the same no_core aliases, byte for byte
     (randomization seeds included).
  2. Same with mini_core's `Pointee::Metadata` lang items (`&u8`, `&str`, `*const [u8]`: the `metadata_type` path).
  3. `ty::Param` -> `Err(TooGeneric)`; `map_error`'s `SizeOverflow` / `ZeroLengthSimdType` / `OversizedSimdType`.
  4. `layout_sanity_check` ICEs with rustc's text when size is not a multiple of align.
  Tests 1–2 use **test-only scaffolding**: each rustc_abi / rustc_middle stub they cross (`Primitive::{size,
  default_align}`, `Float::align`, `Scalar::{primitive, default_align, size, valid_range, valid_range_mut}`,
  `WrappingRange::{with_start, with_end}`, `Niche::{available, from_scalar}`, `Size::add`, `BackendRepr::{is_unsized,
  is_sized}`, `LayoutData::{is_unsized, is_sized, is_1zst, never_type, scalar, scalar_pair}`,
  `FloatExt::from_float_ty`) is replaced for one test by a copy of its upstream body **only while it still stops
  UNPORTED with its stub path**; once lanes abi-lib / abi-layout-a / middle-layout land, the real fns are used and the
  same oracle comparison checks them. Nothing in src is touched.
- `src/rustc_hir_analysis/check/check.oracle.test.ts` (not my file): `abi: abi_cmse_fn_ptr` and `wf: abi_cmse_fn_ptr`
  now fail **only because their pending stop moved**: `PENDING_ABI.abi_cmse_fn_ptr` must be re-pinned from
  `rustc_ty_utils::layout::layout_of_uncached` to `rustc_abi::layout::LayoutCalculator::layout_of_univariant`
  (see For root).

## Samples (lane vs base; base = detached worktree at `6a5519cc`, removed after)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-105845-ty-utils-layout-whfw` | 41 / 0 / 5 / 0 | `20261021-105847-tul-base-jnol` | 41 / 0 / 5 / 0 |
| thirdump-minicore (46) | `20261021-105922-ty-utils-layout-aofs` | 41 / 0 / 5 / 0 | `20261021-105924-tul-base-a7tw` | 41 / 0 / 5 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-110000-ty-utils-layout-2nv6` | 290 / 0 / 10 / 0 | `20261021-110002-tul-base-8lt3` | 290 / 0 / 10 / 0 |
| hir-tree `--sample 300` (base: `--seed ty-utils-layout`, same sample) | `20261021-110331-ty-utils-layout-3od0` | 300 / 0 / 0 / 0 | `20261021-110334-tul-base-pjz1` | 300 / 0 / 0 / 0 |

No new DIFF; statuses identical. Stops that moved past `layout_of_uncached` (tydump-minicore and thirdump-minicore
alike) into the lanes 2/3 stubs, as expected:
- `mini_core.rs` (unit struct `Global`): -> `rustc_abi::layout::LayoutCalculator::layout_of_struct_or_enum` (abi-layout-a);
- `lang-items/issue-87573.rs` (`bool`): -> `rustc_abi::layout::simple::LayoutData::scalar` (abi-layout-a);
- `no_std/no-core-edition2018-syntax.rs` (`usize`): -> `rustc_abi::Primitive::size` (abi-lib);
- tydump-nocore `proc-macro/derive-test.rs`: -> `rustc_abi::Primitive::size` (abi-lib).
The other two minicore stops are unchanged and not layout (`const_eval_poly`, M4; pending `ty::Value`).

## `unported(...)` left (all in layout.ts)
- `u64_as_usize`: `unported("Size beyond 2^53 (rustc_ty_utils::layout: u64 as usize)")` (see Size sites).
- `CoroutineLayout_field_tys` / `CoroutineLayout_variant_fields` / `CoroutineLayout_storage_conflicts`: views of
  `mir::CoroutineLayout` (pending, MIR = M4); reached only by the coroutine arm in `TypingMode::Codegen` and by
  `variant_info_for_coroutine`.
- Implicit: `record_layout_for_printing`'s `record` reads `sess.code_stats`, a deferred field
  (`rustc_session::code_stats::CodeStats`), so `-Zprint-type-sizes` stops UNPORTED at the first recorded layout.
- Every other stop on the layout path is another lane's stub (rustc_abi, rustc_middle ty/layout.rs).

## Size sites (root decision: `Size` is a `number`, never silently round)
- `layout.rs` SIMD lane limit: `limit.value_within_limit(e_len as usize)` takes a `number`; `e_len` (`u64`, a
  `bigint`) goes through `u64_as_usize`, which stops UNPORTED above 2^53 − 1.
- Size arithmetic goes through the contract's helpers, whose overflow behaviour is lane abi-lib's: `Size::add`
  (`offset + field_layout.size`, 3× in `variant_info_for_*`), `Size::add_assign` (`variant_size += ..`), `Size::mul`
  (`element_size * count.as_u64()` in `check_layout_abi`, dead code; the lane count is a `NonZero<u16>`, exact).
- `layout_sanity_check`: `size.bytes() % align.bytes()` and `size.bytes() >= obj_size_bound()` compare exact numbers
  (a `Size` holds an exact byte count by construction; `obj_size_bound` is a power of two, exact).
- Exact conversions only: `BigInt(element_count)`, `BigInt(idx)`; array counts stay `bigint` into
  `layout_of_array_like`.

## `// PORT:` decisions
1. `ty::Adt(def, _) if def.repr().scalable()` / `if def.repr().simd()` / `ty::Adt(def, args)`: one `case "Adt"`, the
   guards as `if`s in upstream arm order (`break` leaves the switch).
2. `LayoutData::clone(&layout.0)` is a local `clone_LayoutData` (fresh, unfrozen; field values shared). `&mut
   layout.backend_repr` in the pattern-type arms replaces the backend repr with one holding a fresh copy of the scalar
   before mutating it (contract decision 3; the source layout is interned and deep-frozen).
3. `scalar.valid_range_mut().start = v` is `r.value = r.value.with_start(v)` (contract convention), via local
   `set_valid_range_start` / `set_valid_range_end`.
4. `ReprOptions::default()` is a local `ReprOptions_default()` (derived `Default`; rustc_abi has no TS default).
5. `cfg!(debug_assertions)` is a local function returning `false` (both files), so the dead code type-checks.
6. `?` inside closures / iterator chains (`univariant`, field-layout `try_collect`s, the or-pattern `collect::<Result<
   Vec>>`) returns at the first `Err` in upstream order; `IndexVec`s are arrays; `discriminants_iter` is a generator.
7. `as u128` of `signed_int_min()` / `signed_int_max()` is `BigInt.asUintN(128, ..)`; `variants.sort()` on
   `(u128, u128)` uses a local lexicographic comparator.
8. rustc_session code_stats.rs is not ported: `SizeKind`, `FieldKind`, `FieldInfo`, `VariantInfo` and a `CodeStats`
   view are local types at the bottom of layout.ts (replacing the contract's `VariantInfo = unknown`).
9. `mir::CoroutineLayout` fields via local views that stop UNPORTED (above).
10. `itertools::zip_eq` panics with itertools' message on a length mismatch; `variant_infos.drain(1..=2)` panics with
    std's range message if fewer than 3 variants.
11. invariant.rs: the nested fns are nested functions in `layout_sanity_check` with their markers; `non_zst_fields`
    is a generator (lazy like the upstream `impl Iterator`; **signature changed** from the contract's array, which
    would have computed every field layout eagerly); `assert_eq!` / `assert_matches!` with a message use core's text
    with arguments through local helpers (built only on failure).
12. Small local helpers in layout.ts: `result_map` (`Result::map`), `size_eq`, `size_max` (`Ord::max`, `other` when
    equal).

## For root
1. Re-pin `src/rustc_hir_analysis/check/check.oracle.test.ts` `PENDING_ABI.abi_cmse_fn_ptr` to
   `rustc_abi::layout::LayoutCalculator::layout_of_univariant` (the one-line change; the stop moved past my code).
   Its comment chain can add "then ty-utils-layout: `layout_of_uncached` is ported".
2. Stale comment only: `src/rustc_middle/ty/sty.test.ts:394` mentions the `layout_of_uncached` stub.
3. When rustc_session code_stats.rs is ported, move the local `VariantInfo` / `FieldInfo` / `SizeKind` / `FieldKind`
   there (and `DataTypeKind` from rustc_middle ty/adt.ts), and drop the `CodeStats` view.
4. Candidates for shared helpers (now local): `ReprOptions::default` (rustc_abi), `Ord::max` of `Size`, `Result::map`
   (std), `assert_eq!` / `assert_matches!` with a message (std/panic.ts).
5. Once lanes 2/3 land, `layout.test.ts` runs without scaffolding automatically (each scaffold is installed only while
   its stub still stops UNPORTED); the scaffolds can then be deleted.
