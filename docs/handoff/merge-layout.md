# Handoff: merge-layout (fixer on `integ-layout`)

Branch `integ-layout`, base `f4ab4c10` (integ-w19 `ec00a1a2` + layout-contract + the five layout fill lanes). No baselines, oracle
outputs, suites, `harness/`, `scripts/`, `tools/` touched. Nothing in rustc_trait_selection/error_reporting.

## Result
- Tests green, with no weakened assertions. `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000`:
  - at `59313873` (after the re-pins): 5384 pass, 1 skip, 0 fail;
  - at the final code commit `601f3566`: **5387 pass, 1 skip, 0 fail**;
  - wider subset (rustc_abi, ty_utils, middle, hir_analysis, data_structures, index, hir_typeck, type_ir, session, mir_build): 1022 pass, 0 fail.
- `mini_core.rs` now **MATCHES** on tydump-minicore and thirdump-minicore. tydump-minicore and thirdump-minicore are each 45/46 (base: 41/46).
  The one case left is `mini_core_hello_world.rs`, which stops at `TyCtxt::const_eval_poly (M4)` (rustc_middle ty/adt.ts `eval_explicit_discr`).
  That stop is const eval, not layout.
- End-to-end layout oracle test: **78 `#[rustc_dump_layout(debug)]` layouts are byte-identical to rustc**, randomization seeds included.
  Another 4 are pinned at the const-eval stop.

## Re-pins / promotions (old → new)
- `src/rustc_hir_analysis/check/check.oracle.test.ts`: the `PENDING_ABI.abi_cmse_fn_ptr` pin
  (`rustc_ty_utils::layout::layout_of_uncached`) is gone. `abi: abi_cmse_fn_ptr` and `wf: abi_cmse_fn_ptr` are now **full oracle matches**
  (stderr and exit code).
- `src/rustc_ty_utils/layout_contract.test.ts`, the in-process test (`mk_layout interns; tcx.layout_of computes layouts ...`). Each stop
  check is now a value check:
  - `layout_of(u8)` → size 1 / align 1;
  - `cx.layout_of(bool)` → `Scalar(u8 is 0..=1)`;
  - `spanned_layout_of(i32)` → 4 / 4;
  - `Ty::new_array(u8, 3)` → layout 3 / 1;
  - `SizeSkeleton::compute(u16)` → `Known(2 bytes, Some(align 2))`;
  - `ty_and_layout_field((u32,), 0)` → `u32`, 4 / 4.
- `src/rustc_ty_utils/layout.test.ts`: rewritten (see below). ty-utils-layout's test-only scaffolds are deleted. None of them was still
  being installed, because every stub is filled.
- `src/rustc_middle/ty/sty.test.ts`: comment only.

## Oracle layout coverage (`src/rustc_ty_utils/layout.test.ts`)
How it works:
- Each source is compiled in-process. For every `#[rustc_dump_layout(debug)]` item, the test does what rustc_passes layout_test.rs
  `dump_layout_of` does: `TypingEnv::codegen`, `type_of`, `layout_of`, and the `normalize_erasing_regions` Display. `ensure_wf` is left
  out, and layout_test.rs is not ported.
- The output is compared with the pinned rustc's stderr, message by message, in the same order.
- The in-process file has the oracle's file name, because the crate name feeds the def-path hashes that seed ADT layouts.

| source | items | covers | status |
|---|---|---|---|
| layout_scalars | 12 | ints, `bool`, `char`, `usize`, `f64`, `i128`, `&u8`, `*const u8`, `!`, `&str`, `*mut [u16]` (struct-tail path) | MATCH |
| layout_pointee | 3 | wide pointers via `Pointee::Metadata` | MATCH |
| layout_aggregates | 59 | see the list below | MATCH |
| layout_sizes | 4 | `[(); usize::MAX]`, two `SizeOverflow`s (`values of the type .. are too big`), `[u8; 2^52-1]` | MATCH |
| layout_discriminants | 4 | C-like enums with explicit (and negative) discriminants | pinned: `const_eval_poly (M4)` |

`layout_aggregates` covers:
- `()`, `f32`, `u128`, `fn` ptr, `&[u32]`, `[u8]`, `str`;
- 9 tuples, including field reordering, both niche biases and `(u8, !)`;
- structs in repr Rust / C / packed / packed(2) / transparent / align(8), ZSTs, an unsized tail, and a generic struct through an alias;
- 4 unions (repr C, transparent);
- arrays, including `[u32; 0]`, `[(); 4]` and nested arrays;
- enums:
  - empty and single-variant;
  - C-like;
  - repr(u8), repr(i32) and repr(C) with data;
  - niche-filling and tagged;
  - an uninhabited variant;
- `Option<&u8>`, `Option<bool>`, `Option<char>`, `Option<u32>`, `Option<Option<bool>>`, `Option<(bool, u8)>`, `Option<!>`,
  `Option<&str>`, `Result<u32, ()>` and `Result<[u32; 0], bool>`;
- `UnsafeCell<bool>`, `Option<UnsafeCell<bool>>` (niche hidden) and `UnsafeCell<(bool, char)>`.

Coroutine layouts are not reachable: they need `mir::CoroutineLayout` (M4). No DIFF was found, so no layout code needed a fix.

## Root items done (task 3)
- rustc_hir_typeck:
  - `decls.ts` `SizeSkeleton` re-exports rustc_middle's.
  - `intrinsicck.ts`: `skeleton_string`, `LayoutError::NormalizationFailure` and the whole transmute size check (E0591 / E0512) are ported
    on `SizeSkeleton::compute` / `same_size`.
  - New oracle test `intrinsicck.test.ts` + `intrinsicck_test/` (`transmute_sizes.rs`, modelled on loops.test.ts). Its 8 errors match the
    pinned rustc byte for byte: known sizes, `this type does not have a fixed size`, `size can vary because of T`,
    `the type T has an unknown layout`, and E0591 for a fn item and for `Option<fn item>`.
- `Integer_discriminant` now lives in rustc_abi lib.ts. rustc_abi layout.ts (`layout_of_enum`, which replaces the local `INTEGER_ORDER`)
  and rustc_middle ty/layout.ts both use it.
- The local copies are gone:
  - `ReprOptions::default()` is now a static in rustc_abi lib.ts (derived `Default`). It replaces the copies in coroutine.ts and in
    rustc_ty_utils layout.ts.
  - `DenseBitSet::insert_all` is now in rustc_index bit_set.ts, marker :210.
  - `IndexSlice::invert_bijective_mapping` is in the new `src/rustc_index/slice.ts`, marker :185.
- `TargetDataLayoutError_into_diag` replaces the stand-ins in rustc_session `config/cfg.ts` and rustc_middle `ty/context.ts`
  (`emit_fatal`). This could not be checked end to end: `--target <path>.json` stops at `TargetTuple::from_path`.
- rustc_hir_analysis `check/check.ts`: the code after `layout_of` is ported. That covers all of `check_static_inhabited` (`TooLargeStatic`,
  InvalidSimd `span_err`, `span_delayed_bug`, the `UNINHABITED_STATIC` lint) and `check_transparent`'s non-trivial-field `filter_map`.
  This was mini_core.rs's stop.
- Array counts are now passed to `Size` as `bigint`:
  - `layout_of_array_like` → `checked_mul(count)`; the local 2^53 branch is gone because `checked_mul` is exact.
  - `vector_type_layout` and invariant.rs pass `BackendLaneCount::as_u64` as is.
  - layout/ty.rs `add_data_ranges` → `elem.size.mul(count)`. The `0..count` loop keeps `array_count_as_number`.
- Also from layout-contract's list:
  - `fn_ctxt/checks.ts` `check_expr_lit`: the pattern-type literal check now uses `layout_of` (it was `unported`). tydump-nocore and
    tydump-ui `pattern_types` show no DIFF.
  - rustc_mir_build `thir/cx/expr.ts`: `layout._0.size`, and the panic now uses `{e:?}`.
- Outside layout, needed for mini_core.rs:
  - rustc_type_ir `fast_reject.ts` `Value_valtree` and `relate.ts` `Value_valtree_kind` now call `ty::Value::valtree` (rustc_middle
    valtree.ts:235), as walk.ts does. Before, they were `unported` stand-ins ("ty::Value is pending"); `ty::Value` has been ported since
    lane ty-results.
  - This fixes mini_core.rs and `no-core-edition2018-syntax.rs`.
- Not done: the local `FIRST_VARIANT` consts. There are 8, in rustc_hir_typeck, rustc_middle, rustc_mir_build and rustc_hir_analysis.
  Switching them to rustc_abi's `FIRST_VARIANT` is cosmetic and touches files that other fixers are working on, so it is left to their owners.

## Samples (lane vs base `ec00a1a2`)
- The base ran in a temporary detached worktree, which has been removed.
- Both sides used `RUST_TS_AGENT=merge-layout`, so the samples are the same.
- Both sides ran with the oracle PATH (`.data/tmp/oracle-PATH.txt`).

| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-123915-merge-layout-mry8` | 45 / 0 / 1 / 0 | `20261021-122838-merge-layout-adpf` | 41 / 0 / 5 / 0 |
| thirdump-minicore (46) | `20261021-123928-merge-layout-rtib` | 45 / 0 / 1 / 0 | `20261021-122858-merge-layout-hesf` | 41 / 0 / 5 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-123940-merge-layout-e74l` | 291 / 0 / 9 / 0 | `20261021-122916-merge-layout-iu2m` | 290 / 0 / 10 / 0 |
| tydump-ui `--sample 400` | `20261021-124045-merge-layout-mdl3` | 217 / 8 / 175 / 0 | `20261021-123048-merge-layout-h8ty` | 200 / 5 / 195 / 0 |
| hir-tree `--sample 300` | `20261021-124228-merge-layout-o8l1` | 300 / 0 / 0 / 0 | `20261021-123322-merge-layout-cfyz` | 300 / 0 / 0 / 0 |
| expanded `--sample 300` | `20261021-124339-merge-layout-x4wg` | 300 / 0 / 0 / 0 | `20261021-123506-merge-layout-56o6` | 300 / 0 / 0 / 0 |

Case by case:
- No MATCH became anything else.
- UNPORTED → MATCH: 4 + 4 (minicore), 1 (nocore), 17 (tydump-ui).
- 9 tydump-ui stops moved.
- **3 tydump-ui cases went UNPORTED → DIFF.** Before, each stopped at a layout stand-in. Now they run further, into **pre-existing
  next-solver error-reporting divergences**. None of these is in layout code:
  - `traits/next-solver/normalize/old-solver-caching-bug-151069.rs#next`: the subject emits two E0275 overflow errors twice each. The base
    subject emits the same duplicates before its layout stop, which I checked by running base `tydump.ts` directly. The layout-reached part
    (`<Foo as Pointee>::Metadata`) matches.
  - `traits/next-solver/cycles/coinduction/item-bound-via-impl-where-clause.rs#next`: the E0275 `<Vec<u8> as Trait<String>>::Proof == _`
    is emitted twice. rustc emits it once.
  - `traits/next-solver/diagnostics/iterator-item-suggest-no-ice.rs`: an extra E0271 `<&_ as Iterator>::Item == &()` that rustc suppresses.

  All three are in fulfillment-error reporting (rustc_trait_selection error_reporting: duplicate / implied-error suppression), which this
  fixer must not touch. **For root:** route them to whoever owns error_reporting. Nothing about them is layout-specific. No sampled UNPORTED
  stop names layout code any more.

## Remaining minicore stops
- `mini_core_hello_world.rs` (both suites): `rustc_middle::mir::interpret::TyCtxt::const_eval_poly (M4)`. This is explicit enum
  discriminant evaluation (ty/adt.ts `eval_explicit_discr`), the same stop as layout.test.ts's `layout_discriminants`. It is outside
  layout. Gate M3b needs const eval of explicit discriminants, or a root decision.

## `unported(...)` left / added
- None added on a reachable path.
- The old `unported`s replaced here:
  - check.ts ×2 (`the value of layout_of, M4`);
  - intrinsicck.ts ×3;
  - checks.ts ×1;
  - cfg.ts / context.ts ×2;
  - type_ir ×2.
- Still there, from the lanes: `SIZE_BEYOND_2_53` sites; `-Zrandomize-layout` shuffle; `CoroutineLayout` views (M4);
  `vtable_min_entries`; `codegen_handle_fn_abi_err` span_bugs; `record_layout_for_printing` (`CodeStats`).

## Checks
- `bunx tsc --noEmit -p .` clean.
- `bun scripts/coverage.ts --check` markers ok.
- Coverage:
  - rustc_abi 272/273;
  - rustc_middle ty/layout.rs 61/61;
  - rustc_index slice.rs 1/29 (new file);
  - TOTAL 16703/25518.
- Final full run (`601f3566`, `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000`): 5387 pass, 1 skip, 0 fail.

## PORT decisions (consolidated, for `bun scripts/state.ts record decision`)
layout-contract:
1. Layout types are hand-written, with no codegen set. The `FieldIdx` / `VariantIdx` generics are erased (rustc instantiates only those);
   `LocalIdx` stays generic. `FieldIdx` / `VariantIdx` live in rustc_abi layout.ts, and rustc_middle ty/decls.ts re-exports them.
2. Number types:
   - `u128` (valid ranges, niche starts, discriminants) are `bigint`;
   - `u64` element counts (`FieldsShape::Array.count`, `count_if_sized`, SIMD counts) are `bigint`;
   - `Size` is a `number`;
   - `NonZero<usize>` union field count is a `number`;
   - `BackendLaneCount` / `NumScalableVectors` are branded numbers.
3. Mutability:
   - `LayoutData` / `VariantLayout` fields are mutable. Value types (`Primitive`, `Niche`, `WrappingRange`, `TagEncoding`, `BackendRepr`,
     `PointeeInfo`, `Size`, `Align`) are immutable.
   - The only writable field is `Scalar::Initialized.valid_range`, through `valid_range_mut` → `MutRef`; `.start = s` is
     `r.value = r.value.with_start(s)`.
   - `a += b` is `a = a.add_assign(b)`.
   - A `Copy` value that is then mutated must be a fresh object.
   - Interned layouts are deep-frozen.
4. Derived `PartialEq`: explicit `_eq` for `Primitive` / `Scalar` / `WrappingRange` / `Niche` / `TyAndLayout`. The aggregate `_eq`s
   (`FieldsShape`, `BackendRepr`, `Variants`, `LayoutData`, `Numeric`) compare `intern_key`s.
5. `Layout` and `TyAndLayout` Deref:
   - `Layout` is `class Layout extends Interned` (`internee`); its Deref is `deref_()`.
   - `TyAndLayout` derefs straight to `LayoutData` (`deref()` + read-only getters and method forwarders); `as_ref()` is
     `AsRef<LayoutData>`.
6. `Ty: TyAbiInterface` is rustc_middle's table, registered with rustc_abi at load (`register_ty_abi_interface`). `C: HasTyCtxt +
   HasTypingEnv` is `LayoutCxLike`.
7. `HasTyCtxt::tcx` / `HasTypingEnv::typing_env` are `tcx_()` / `typing_env_()`.
8. Associated types are readonly descriptor members (`LayoutOfResult`, `FnAbiOfResult`). The blanket `LayoutOf for C` is
   `LayoutOf_provided`, installed as forwarders on `LayoutCx`. `&'tcx LayoutError` is `LayoutError`.
9. Placement and init order:
   - rustc_abi lib.ts is both the definer and the crate root, and re-exports layout.ts / layout/ty.ts / wrapping_range.ts / callconv.ts,
     which read lib.ts values only inside function bodies.
   - simple.rs constructors are statics of `LayoutData`; callconv.rs's `homogeneous_aggregate` is in the `TyAndLayout` body.
   - rustc_middle ty/layout.ts is an extension module, and generated modules import it type-only.
10. A unit struct is `null` (`Heterogeneous`, `AbiMismatch`), and `RangeFull` is `null`. Stub form while contracts are open:
    `// stub: <path>:<line> <name> (lane <lane>)`.

abi-lib:
11. `Size` arithmetic is exact (`bigint` inside). A byte/bit count past 2^53-1 calls `unported(SIZE_BEYOND_2_53)`. In detail:
    - `from_bytes` / `from_bits` / `checked_mul` / `mul` / `u64_mul` accept `bigint`;
    - `checked_*` `None` is exact at or above `obj_size_bound` / `u64::MAX`;
    - upstream overflow panics are kept;
    - `Step for Size` wraps like u64 (no overflow checks).
12. `TargetDataLayoutError::into_diag` is `TargetDataLayoutError_into_diag(self, dcx, level)`. `BackendLaneCount::new` is one range test on
    the `bigint`.
13. `FieldsShape::index_by_increasing_offset` returns an array. `WrappingRange::with_start` / `with_end` return new values.
14. `smallest_range_containing` writes out `reduce` / `sort_unstable` / `array_windows` / `min_by_key` (first minimum wins). The
    `reg_ctor!` constructors are written-out statics.

abi-layout-a:
15. Stable `sort_by_key` is `Array.prototype.sort` with lexicographic tuple comparators, using `bigint` parts (`!x` as `MAX ^ x`,
    `Reverse` compared reversed). Sorting a sub-slice sorts a copy and writes it back.
16. Lazy iterators keep their short-circuit points. These include `present_variants` and the `non_zst_fields` count.
17. `cfg!(feature = "randomize")` is true. The `-Zrandomize-layout` shuffle is `unported` (vendor rand crates).
18. `hide_niches(&mut Scalar)` uses a `MutRef` and writes back a fresh `BackendRepr`. `niche.offset += ..` builds a new `Niche`.
19. In `scalar_pair`, `max_by_key` evaluates both `from_scalar`s first, and a tie keeps the later niche. The simple.rs seeds use `bigint`
    `wrapping_add` / `rotate_right`.

abi-layout-b:
20. `RangeSet<T>`'s bounds are a function table `RangeSetOps<T>`, so `RangeSet::new()` is `RangeSet.new(ops)`; layout/ty.ts has
    `SIZE_RANGE_SET_OPS`. `partition_point` is a local binary search.
21. The upstream bug in `RangeSet::difference` (it pushes end values as sizes) is kept and pinned by a test.
22. `layout_of_enum`:
    - `Option<Align>` max: `None < Some`;
    - `Ord::max` returns `other` on ties and `min` returns `self`;
    - `max_by_key` keeps the last maximum;
    - the final `(size, niche)` choice evaluates both sides eagerly;
    - the guarded or-pattern `(Pointer, Int) | (Int, Pointer)` is one condition.
23. coroutine.rs: `(len - 1) as u128` wraps like usize. `prefix_layouts` is mutated in place. `F: Deref<Target = &LayoutData>` is read as
    `f.deref().x`.
24. Shared `Copy` scalars: the same `tag` / `niche_scalar` object goes in `Variants::Multiple.tag` and in `backend_repr`. A writer must
    copy it first.

middle-layout:
25. `i128::cast_unsigned` / `u128::cast_signed` are `BigInt.asUintN` / `asIntN(128, ..)`. `Size` `==` / `<=` compare `.bytes()`.
    `size * (flag as u64)` is `size.mul(flag ? 1 : 0)`.
26. `SizeSkeleton::compute_inner`'s lazy fields iterator is unrolled. `nth(..).unwrap()` / indexing use `iter_nth` / `index_slice` with
    Rust's panic messages.
27. FnAbi provided fns are ported, and their query values are cast as in `TyCtxt_fn_abi_of_instance`. `codegen_handle_fn_abi_err`'s
    span_bugs are `unported` (Instance / PolyFnSig Display, M4).
28. rustc_target::spec, ty::sty and crate::traits are lazily `require`d from ty/layout.ts (init order).

ty-utils-layout:
29. Guarded `ty::Adt` arms are one `case "Adt"` with `if`s in arm order. `LayoutData::clone` is a fresh unfrozen copy, and pattern-type arms
    copy the scalar before writing its range.
30. `cfg!(debug_assertions)` is a function returning `false`. `?` in closures and iterator chains stops at the first `Err` in upstream
    order. `discriminants_iter` is a generator.
31. rustc_session code_stats.rs is not ported. `VariantInfo` / `FieldInfo` / `SizeKind` / `FieldKind` / `CodeStats` are local types in
    rustc_ty_utils layout.ts until that file is ported, and `-Zprint-type-sizes` stops UNPORTED.
32. `itertools::zip_eq` and `drain(1..=2)` panic with their crates' messages. invariant.rs's nested fns are nested, and `non_zst_fields` is a
    generator.

merge-layout:
33. `Integer_discriminant` (derived `Ord`) lives in rustc_abi lib.ts and is shared. `ReprOptions::default()` is a static on the class.
    `IndexSlice` methods are free functions in rustc_index slice.ts, taking the array first.
34. Oracle layout tests run rustc_passes layout_test.rs's `dump_layout_of` steps in-process. `ensure_wf` is left out and layout_test.rs is
    not ported. The in-process source keeps the oracle's file name, because the crate name seeds ADT layouts.
35. rustc_type_ir's `inherent::ValueConst::valtree` uses rustc_middle's `Value.valtree` (value import, as walk.ts).
