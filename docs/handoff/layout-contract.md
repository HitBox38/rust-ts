# Handoff: layout-contract (M3b, contract-first): the type-layout contract

Branch `lane/layout-contract` (from integ-w19 `d5cecdfc`, no merges). Commits: contract (types + Debug, stub declarations,
`layout_of` provider wiring, `LayoutOf` glue, `mk_layout`, stand-ins repointed, contract test) → lane re-assignments in stub
comments + this handoff.

## Result
- **`tcx.layout_of(..)` reaches the real provider.** rustc_ty_utils `provide` registers `layout_of` (layout.rs:35); the
  provider (layout.rs:40) is ported: post-analysis normalization, `set_aliases_to_non_rigid`, the `Codegen` retry, `LayoutCx`,
  `TyAndLayout`, `-Zprint-type-sizes`, `layout_sanity_check`. It stops at the first stub, `layout_of_uncached` (lane
  ty-utils-layout). `TyCtxt::mk_layout` (context.rs:2019) is real (intern key = derived `Hash`/`Eq` of `LayoutData`).
- **Types (hand-written, with their Debug impls)**, at their mirrored files:
  - rustc_abi `lib.ts`: `BackendLaneCount`, `MAX_SIMD_LANES`, `Float`, `Numeric`, `Primitive` (+ manual Debug), `Scalar` (+ manual
    Debug), `FieldsShape`, `NumScalableVectors`, `BackendRepr`, `RangeInclusive` (local `core::range` shape), `Variants`,
    `TagEncoding`, `Niche`, `NicheOptimizations`, `LayoutData` (+ manual Debug, prints `Layout { .. }`), `PointerKind`,
    `PointeeInfo`, `StructKind`, `AbiFromStrErr`, `VariantLayout`, `Step_Size`; `AbiAlign::deref`.
  - rustc_abi `layout.ts` (new): `FieldIdx` / `VariantIdx` / `FIRST_VARIANT` (moved from rustc_middle ty/decls.ts, which
    re-exports them), `NicheBias`, `LayoutCalculatorError<F>`, `LayoutCalculator<Cx>`, `SimdVectorKind`, `DerefLayoutData` /
    `AsRefLayoutData` (the `F` bounds), `RangeFrom` / `RangeToInclusive` (local std shapes).
  - rustc_abi `layout/ty.ts` (new): `Layout` (interned, deep-frozen), `TyAndLayout<Ty>` (Deref to `LayoutData`),
    `TyAbiInterface<Ty, C>` + registry; `layout/coroutine.ts` (new): `SavedLocalEligibility`; `wrapping_range.ts` (new):
    `WrappingRange` (+ manual Debug, `debug_as`, `full`); `callconv.ts` / `callconv/reg.ts` (new): `HomogeneousAggregate`,
    `Heterogeneous`, `RegKind`, `Reg`.
  - rustc_middle `ty/layout.ts`: `ValidityRequirement`, `SimdLayoutError`, `LayoutError` (+ Display + `IntoDiagArg`),
    `LayoutCx`, `SizeSkeleton`, `HasTyCtxt`, `HasTypingEnv`, `MaybeResult` (+ both impls), `TyAndLayout` (= `abi.TyAndLayout<Ty>`,
    `debug_TyAndLayout_Ty`), `LayoutOfHelpers` / `LayoutOf` (+ `_provided`), `TyAbiInterface_Ty` (registered), `FnAbiError`,
    `FnAbiRequest`, `FnAbiOfHelpers` / `FnAbiOf` (+ `_provided`), `FloatExt` / `PrimitiveExt` companions, `WIDE_PTR_*`.
  - Debug output checked against rustc's own `{:#?}` (tests/ui/layout/debug.stderr: `Option<bool>`, `i32`, union `V`).
- **Declarations**: every one of the 320 upstream fns of the scope files is either ported (`// rustc:` marker, 152) or
  declared (168 stubs): `// stub: <upstream path>:<line> <name> (lane <lane>)` directly over a declaration with its final
  signature whose body is `return unported("<crate>::<module>::<Type>::<name>")`. Stubs live where the fn will live (class
  bodies, companion consts, module-level fns); `src/rustc_ty_utils/layout_contract.test.ts` checks the scan = coverage.
- **Ported for real (hub / glue / Debug)**: rustc_ty_utils layout.rs 3/9 (`provide`, `layout_of`, `error`); rustc_middle
  ty/layout.rs 32/61 (was 4: `LayoutError` Display / `into_diag_arg`, `LayoutCx::new` + its 7 trait impls, `HasTyCtxt` /
  `HasTypingEnv` / `MaybeResult` (2 decls + 4 impl fns) / `LayoutOfHelpers` (2) / `LayoutOf` (2) / `FnAbiOfHelpers` decl,
  `impl HasTargetSpec / HasX86AbiOpt / HasTyCtxt for TyCtxt`, `impl HasDataLayout / HasTargetSpec / HasTyCtxt for TyCtxtAt`);
  rustc_abi lib.rs 88/157 (was 81: `Float::{size, ty_str}`, `Primitive` / `Scalar` / `LayoutData` Debug, `AbiAlign::deref`,
  `&TargetDataLayout::data_layout`), layout.rs 1/16 (`LayoutCalculator::new`), layout/ty.rs 25/47 (`Layout` Debug / Deref /
  8 accessors, `TyAndLayout` Debug / Deref / `as_ref`, the 13 `TyAbiInterface` trait declarations), wrapping_range.rs 3/12.
- **Stand-ins repointed to the contract** (so their stops moved to the exact stub): rustc_middle `Const::from_bits`
  (ty/consts.ts, `layout_of_size`) and `Value::try_to_bits` (ty/consts/valtree.ts, `layout_size_of`) now call
  `tcx.layout_of`; rustc_hir_analysis `coherence/builtin.ts` / `builtin/coerce_shared.ts` (`LayoutData_is_zst` /
  `LayoutData_is_1zst` removed → `layout.is_zst()` / `is_1zst()`), `hir_ty_lowering/cmse.ts` (`LayoutErrorView`, 4 stand-ins
  removed → `layout.layout.size().bytes()`, `layout.layout.align().abi.bytes()`, `LayoutCx.new`,
  `peel_transparent_wrappers_from_non_1zst(cx).ty`), `decls.ts` (`LayoutCx` is the real type).

## Representation decisions (please record)
1. **Hand-written types, no codegen set.** rustc_abi's types were already hand-written (lib.ts subset); the layout types follow.
   `FieldIdx` / `VariantIdx` generics of `LayoutData` / `FieldsShape` / `Variants` / `TagEncoding` / `VariantLayout` /
   `LayoutCalculator` are erased (rustc instantiates them only with `rustc_abi::{FieldIdx, VariantIdx}`); `LocalIdx`
   (coroutines) stays generic. `FieldIdx` / `VariantIdx` moved to rustc_abi layout.ts (ty/decls.ts re-exports).
2. **Numbers**: `u128` (valid ranges, niche starts, discriminants) are `bigint`; `u64` element counts (`FieldsShape::Array.count`,
   `count_if_sized`, SIMD counts, `BackendLaneCount::new`) are `bigint` (`[(); usize::MAX]` exists); `Size` stays `number`
   (existing PORT: byte sizes < 2^53), so `Size` arithmetic takes `number` counts (`Size.mul(count)`, `Size.u64_mul(count,
   size)` for `Mul<Size> for u64`); `NonZero<usize>` (`Union` field count) is `number`; `BackendLaneCount` /
   `NumScalableVectors` are branded numbers.
3. **Mutability / Copy**: `LayoutData` / `VariantLayout` fields are mutable (`st.size = ..`); value types (`Primitive`, `Niche`,
   `WrappingRange`, `TagEncoding`, `BackendRepr`, `PointeeInfo`, `Size`, `Align`) are immutable; only `Scalar::Initialized.
   valid_range` is writable (`valid_range_mut` returns a `MutRef<WrappingRange>` over it; `WrappingRange` is immutable, so
   `.start = s` is `r.value = r.value.with_start(s)`). `Size += ..` is `size = size.add_assign(..)`. A `Copy` value that is
   then mutated must be a fresh object. **Interned layouts are deep-frozen** (`Layout` constructor), so a write into a shared
   sub-object throws (CRASH) instead of silently corrupting an interned layout.
4. **Derived `PartialEq`** of the layout value types: explicit `_eq` for `Primitive` / `Scalar` / `WrappingRange` / `Niche` /
   `TyAndLayout` (identity of `ty` + `layout`); `FieldsShape_eq` / `BackendRepr_eq` / `Variants_eq` / `LayoutData_eq` /
   `Numeric_eq` compare `intern_key`s (rust_ts/intern_key.ts: equal exactly when the derived `Eq` is).
5. **`Layout(Interned<LayoutData>)`** is `class Layout extends Interned` with the field `internee` (`layout.0.0`); its Deref is
   `deref_()` (`Interned` owns `deref`; Pattern precedent). **`TyAndLayout`'s Deref** (straight to `&LayoutData`, skipping
   `Layout`, whose methods `size()` / `fields()` would shadow the fields) is `deref()` + hand-written read-only getters for the
   11 `LayoutData` fields and forwarders for its methods (`tl.size`, `tl.is_zst()`); `TyAndLayout::is_scalable_vector` shadows
   `LayoutData::is_scalable_vector` as in Rust. `as_ref()` is `AsRef<LayoutData>`.
6. **`Ty: TyAbiInterface<'a, C>`**: one impl exists (rustc_middle's `impl TyAbiInterface for Ty`), registered with rustc_abi
   at load (`register_ty_abi_interface(TyAbiInterface_Ty)`, the `IR_PRINT` precedent); `Ty::ty_and_layout_field(self, cx, i)`
   is `ty_abi_interface<Ty, C>().ty_and_layout_field(this, cx, i)`. `C: HasTyCtxt + HasTypingEnv` is `LayoutCxLike`.
   `Ty: Display` (Debug of `TyAndLayout`) is a `display_Ty` parameter (`debug_TyAndLayout_Ty` for rustc_middle's `Ty`).
7. **`HasTyCtxt::tcx` / `HasTypingEnv::typing_env` are `tcx_()` / `typing_env_()`** (precedent rustc_lint `LateContext`):
   implementors have `tcx` / `typing_env` fields (`TyCtxtAt`, `LateContext`, `FnCtxt`, `LayoutCx`). Fill lanes write
   `cx.tcx_()` for `cx.tcx()`; `cx.typing_env` (the `LayoutCx` field) stays.
8. **Associated types** are readonly members holding the impl descriptor (`LayoutOfHelpers.LayoutOfResult`,
   `FnAbiOfHelpers.FnAbiOfResult`: `MaybeResult` descriptors; rustc_privacy `DefIdVisitor.DefIdResult` precedent); the blanket
   `impl<C: LayoutOfHelpers> LayoutOf for C` is `LayoutOf_provided`, installed on `LayoutCx` as forwarding methods (`cx.layout_of(ty)`).
   `&'tcx LayoutError` is `LayoutError` (`tcx.arena.alloc(err)` is `err`).
9. **Placement (init order)**: rustc_abi lib.ts is both the defining module of `LayoutData` & co. and the crate root, and it
   re-exports layout.ts / layout/ty.ts / wrapping_range.ts / callconv.ts, which therefore never touch lib.ts values at top level.
   No extension module can assign onto lib.ts classes, so layout/simple.rs's `LayoutData` constructors are statics in the
   `LayoutData` class body and callconv.rs's `TyAndLayout::homogeneous_aggregate` is in the `TyAndLayout` body (PORTING §8);
   there is no `simple.ts`. rustc_middle ty/layout.ts stays an extension module: generated modules must not import it as a
   value (typemap.layout.json entries are type-only, Debug `null`).
10. Small ones: a unit struct (`Heterogeneous`) is `null`; `RangeFull` (`..`) is `null`; the nested fns `field_ty_or_layout`
    (ty/layout.rs:854) and invariant.rs's three are module-level stubs until their lane ports them inside the parent;
    `Reg`'s `reg_ctor!` constructors (`Reg::i8()` ..) are macro-generated (not in the coverage table) and left to lane abi-lib.

## Split table (fill lanes; upstream lines; ordered by what unblocks tydump-minicore)
All three layout stops of tydump-minicore (`mini_core.rs`, `lang-items/issue-87573.rs`, `no_std/no-core-edition2018-syntax.rs`;
also tydump-nocore `proc-macro/derive-test.rs`) are now at `layout_of_uncached`. The first type each lays out (probed in a
scratch copy): `mini_core.rs` the unit struct `Global` (ADT arm → `layout_of_struct_or_enum` → `layout_of_struct` →
`layout_of_univariant`), `issue-87573.rs` `bool` and `no-core-edition2018-syntax.rs` `usize` (scalar arm → `LayoutData::scalar`).
Either path crosses lanes 1–3 (`layout_of_uncached` → simple.rs / univariant → `Scalar` / `Primitive` / `Niche` /
`WrappingRange` helpers → `layout_sanity_check`): run lanes 1–3 in one wave, 4–5 alongside (later types of the same cases
may need them).

| # | lane | upstream | lines | stubs | notes |
|---|---|---|---|---|---|
| 1 | ty-utils-layout | rustc_ty_utils layout.rs (rest: `map_error`, `extract_const_value`, `layout_of_uncached`, `record_layout_for_printing`, `variant_info_for_*`), layout/invariant.rs | ~1340 | 10 | **first stop of every layout today** (`layout_of_uncached`, :207, 670 lines); `layout_sanity_check` runs after every layout (its fast path is 2 checks; the rest is behind `cfg!(debug_assertions)` = false). `VariantInfo` (rustc_session code_stats.rs) is an `unknown` alias: port what `-Zprint-type-sizes` needs or leave the `record_layout_for_printing` path unported |
| 2 | abi-lib | rustc_abi lib.rs (rest: `BackendLaneCount`, `TargetDataLayoutError::into_diag`, `Size` ops + `Step`, `Float::align`, `Numeric`, `Primitive`, `Scalar`, `FieldsShape`, `NumScalableVectors`, `BackendRepr`, `Niche`, `LayoutData` / `VariantLayout` methods), wrapping_range.rs (rest), callconv.rs, callconv/reg.rs | ~1800 | 83 | small methods used by every layout (`Scalar::size`, `Primitive::size`, `Niche::from_scalar` / `reserve`, `WrappingRange::is_full_for`, `LayoutData::is_1zst` ..) |
| 3 | abi-layout-a | rustc_abi layout.rs:1..582 + :1090..1537 (`absent`, `LayoutCalculatorError` fns, `layout_of_array_like`, SIMD / scalable vectors, `layout_of_univariant(_biased)`, `layout_of_struct_or_enum`, `layout_of_union`, `layout_of_struct`, `format_field_niches`, `vector_type_layout`), layout/simple.rs (statics of `LayoutData` in lib.ts) | ~1210 | 19 | `LayoutData::scalar` / `unit` / `scalar_pair` (simple.rs) and `layout_of_univariant` are on the path of the first primitive / struct / tuple layouts |
| 4 | middle-layout | rustc_middle ty/layout.rs (rest: `discr_range_of_repr`, `FloatExt`, `PrimitiveExt`, `ValidityRequirement` fns, `SizeSkeleton` (also unblocks rustc_hir_typeck intrinsicck's transmute check), the `TyAbiInterface for Ty` impl incl. `field_ty_or_layout`, `fn_can_unwind`, `FnAbiError::into_diag`, `codegen_handle_fn_abi_err`, `FnAbiOf` provided fns) | ~1250 | 29 | `ty_and_layout_field` / `for_variant` are needed by `TyAndLayout::field` (enums, ADT fields); the FnAbi part needs rustc_target callconv (`FnAbi` is `Pending1`, M4): keep those stubs if out of reach |
| 5 | abi-layout-b | rustc_abi layout.rs:583..1089 (`layout_of_enum`), layout.rs:244 `layout_of_coroutine`, layout/coroutine.rs, layout/ty.rs (rest: `TyAndLayout::for_variant` / `field` / `pointee_info_at` / `is_*` / padding ranges / `non_1zst_field` / `complex_number` ..) | ~1345 | 26 | enums (niche filling) and coroutines; `RangeSet` (rustc_data_structures range_set.rs) is an `unknown` alias: port it here or in rustc_data_structures |
| — | (done here) | the types + Debug, `layout_of` provider, `provide`, `LayoutOf` glue, `mk_layout` | | | |

## How to fill a stub
1. **Find the stub**: `grep -rn "// stub: compiler/<path>:<line> <name>" src` (one per upstream fn of your files; the list is
   also `bun scripts/coverage.ts --missing <path>`). Keep the signature; a wrong one goes in your handoff (or fix it and say so:
   the declarations are root-owned after integration).
2. Replace the body with the upstream logic, in place (class body / companion const / module fn: wherever the stub is), and
   turn the comment into the marker `// rustc: compiler/<path>:<line> <name>` (drop the `(lane ..)` suffix). Rename `_param`s.
   Nested upstream fns that are module-level stubs (`field_ty_or_layout`, invariant.rs's three) move inside their parent.
3. **Conventions**: rustc_abi layout.ts / layout/ty.ts and rustc_middle ty/layout.ts headers, and the decisions above:
   - `F: Deref<Target = &LayoutData>` fields are `F extends DerefLayoutData` (rustc: `TyAndLayout`): `f.align` / `f.size` /
     `f.is_1zst()` read through the forwarders, `f.deref()` is the `LayoutData`; `F: AsRef` is `f.as_ref()`.
   - `IndexSlice` / `IndexVec` are arrays indexed by the handle number (PORTING §5); `FieldIdx` / `VariantIdx` have the
     `newtype_index` helpers (`from_usize`, `from_u32`, `ZERO`, ..; `FieldIdx.ONE`, `FIRST_VARIANT`).
   - Enums: `$`-tagged objects; data-less variants are frozen singletons on the companion (`FieldsShape.Primitive`,
     `Variants.Empty`, `TagEncoding.Direct`, `StructKind.AlwaysSized`, `LayoutCalculatorError.SizeOverflow`, ...); enum methods
     on companions (`Scalar.size(s, cx)`, `BackendRepr.is_unsized(r)`); struct-with-impl types are classes (`new Niche(offset,
     value, valid_range)`, `new WrappingRange(start, end)`, `new LayoutData(<11 fields in declaration order>)`).
   - `cx.tcx()` → `cx.tcx_()`, `cx.typing_env()` → `cx.typing_env_()`; `cx.layout_of(ty)` / `cx.spanned_layout_of(ty, sp)` on
     a `LayoutCx`; `tcx.mk_layout(data)`; `LayoutError` values are plain objects (`{ $: "Unknown", _0: ty }`).
   - Debug for `debug!` / `trace!` is not needed (comments); assertion messages that format are built only on failure.
4. **Init order**: in rustc_abi, a module's top-level code touches only its own definitions and other crates; lib.ts values
   are read inside function bodies. rustc_middle ty/layout.ts is an extension module (its top level may touch the classes it
   imports); read other extension modules lazily (`pretty()`).
5. `src/rustc_ty_utils/layout_contract.test.ts` must stay green: its counts (320 fns, 168 stubs) go down as you port (update
   the stub count; the fn count changes only with the scope); the runtime checks name stubs (`LayoutData::is_zst`,
   `layout_of_uncached`, ...) and must be re-pinned to the next stop when you port them.

## `unported(...)` left
- 168 stubs (lane counts above; `lib.rs:914 overflow` is a body-less note under the ported `Size::bits`).
- In ported code: `TyAbiInterface` lookup before rustc_middle is loaded (`ty_abi_interface()`); `debug_FnAbiRequest`
  (`ty::Instance` / `PolyFnSig` Debug, M4).
- `FnAbi` stays `Pending1` (rustc_target callconv, M4); `VariantInfo` and `RangeSet` are `unknown` aliases (see the table).

## Re-pinned tests (no matching assertion weakened)
- `src/rustc_hir_analysis/check/check.oracle.test.ts` `PENDING_ABI.abi_cmse_fn_ptr`: `layout_of provider (not ported)` →
  `rustc_ty_utils::layout::layout_of_uncached` (the provider is real now).
- `src/rustc_middle/ty/sty.test.ts` "new_adt interns an ADT type; value-const constructors stop UNPORTED ..": its last check
  (`Ty::new_array` throws `Unported` through the `Const::from_bits` stand-in) now reaches the `layout_of` query, which the
  test's mock `tcx` has no query system for (TypeError). The check moved to `layout_contract.test.ts` with a real `tcx`
  (`Ty::new_array(u8, 3)` stops at `layout_of_uncached`); the test is renamed "new_adt interns an ADT type" (merge-w18d
  precedent: a check that cannot hold in its harness moves to the harness where it can).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (17043; vendor 3888).
- Coverage: rustc_abi 138/273 (was 102), rustc_middle 2204/3369 (was 2176), rustc_ty_utils 82/123 (was 79); TOTAL
  16524/25518 (was 16457). Per file: rustc_abi lib.rs 88/157, layout.rs 1/16, layout/coroutine.rs 0/2, layout/simple.rs 0/6,
  layout/ty.rs 25/47, wrapping_range.rs 3/12, callconv.rs 0/3, callconv/reg.rs 0/3; rustc_ty_utils layout.rs 3/9,
  layout/invariant.rs 0/4; rustc_middle ty/layout.rs 32/61.
- New test `src/rustc_ty_utils/layout_contract.test.ts` (5 tests): scan = coverage (320 fns: 152 markers + 168 stubs, each
  stub's body stops in its own module); Debug = debug.stderr; stubs stop as UNPORTED; `TyAndLayout` Deref / deep freeze;
  in-process `mk_layout` interning, `tcx.layout_of` and `LayoutCx::layout_of` → `layout_of_uncached`.
- Every new / changed module loads as a fresh entry point (rustc_abi lib / layout / layout/ty / layout/coroutine /
  wrapping_range / callconv / callconv/reg, rustc_middle ty/layout + queries.gen, rustc_ty_utils layout / invariant / lib).
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000`: 5360 tests, 1 skip, 13 fail; after re-pinning
  rustc_middle `ty/sty.test.ts` (below) 12 fail, and those 12 fail identically at base `d5cecdfc` (checked in the base worktree):
  wave-19 merge fallout that fixer merge-w19 owns: rustc_infer `contract.test.ts` (`describe_closure` is ported now),
  rustc_hir_typeck `fnsugg_b.oracle.test.ts` (plus_eq) and `fn_ctxt/checks_b.test.ts` (3), std `result.test.ts`
  (`method/suggest.ts:2744` uses one-argument `unwrap_result`), rustc_hir_analysis `wfcheck_a` / `wfcheck_b` /
  `compare_impl_item.oracle` (2), rustc_trait_selection `suggestions_b.test.ts` (2). None is in a file this lane touched.

## Samples (lane vs base; base = `/Users/tomernorman/Documents/personal/rust-ts/.data/lanes/layout-base`, a detached worktree at `d5cecdfc`, `RUST_TS_AGENT=layout-base`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-094557-layout-contract-8aow` | 41 / 0 / 5 / 0 | `20261021-090549-layout-base-iw3i` | 41 / 0 / 5 / 0 |
| thirdump-minicore (46) | `20261021-094623-layout-contract-o3gn` | 41 / 0 / 5 / 0 | `20261021-090601-layout-base-kaoq` | 41 / 0 / 5 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-094639-layout-contract-s9g2` | 290 / 0 / 10 / 0 | `20261021-090614-layout-base-ts3b` | 290 / 0 / 10 / 0 |
| hir-tree `--sample 300` (same sample: base run with `RUST_TS_AGENT=layout-contract`) | `20261021-094808-layout-contract-mxax` | 299 / 0 / 1 / 0 | `20261021-095039-layout-contract-fwcv` | 299 / 0 / 1 / 0 |

No new DIFF; statuses identical. Stops that moved (tydump-minicore and thirdump-minicore alike):
- `mini_core.rs`, `lang-items/issue-87573.rs`: `layout_of provider (not ported)` → `rustc_ty_utils::layout::layout_of_uncached`;
- `no_std/no-core-edition2018-syntax.rs`: `rustc_middle::ty::layout::LayoutOf::layout_of (Const::from_bits; layouts are M4)`
  (stand-in) → `rustc_ty_utils::layout::layout_of_uncached`;
- tydump-nocore `proc-macro/derive-test.rs`: `layout_of provider (not ported)` → `layout_of_uncached`.
The other two minicore stops are not layout: `mini_core_hello_world.rs` (`TyCtxt::const_eval_poly`, M4) and
`lang-items/lang-item-generic-requirements.rs` (`ty::Value: valtree().kind()`, pending `ty::Value`).

## For root
1. Record: "Layout (rustc_abi layout + rustc_ty_utils layout + rustc_middle ty/layout) pulled forward from M4 to M3b: the
   minicore cases stop at `layout_of`" and the decisions above (1 hand types / erased generics, 2 numbers, 3 mutability +
   deep-frozen interned layouts, 4 `_eq` via `intern_key`, 5 `Layout` / `TyAndLayout` Deref, 6 `TyAbiInterface` registry,
   7 `tcx_()` / `typing_env_()`, 8 associated-type descriptors, 9 placement / init order, 10 small ones), the stub form
   `// stub: <path>:<line> <name> (lane <lane>)` and the split table.
2. Review the tools change: new `tools/codegen/typemap.layout.json` (4 type-only entries) and the regenerated
   `src/rustc_middle/queries.gen.ts` (`layout_of`, `fn_abi_of_*` errors, `check_validity_requirement` now typed).
3. Shared files edited outside the scope files (review): rustc_middle `ty/decls.ts` (layout `Pending`s → re-exports,
   `FieldIdx` / `VariantIdx` re-exported from rustc_abi, ty/layout.rs comment lines), `ty/context.ts` (`mk_layout`, interner
   type), `ty/consts.ts`, `ty/consts/valtree.ts`; rustc_ty_utils `lib.ts`; rustc_hir_analysis `decls.ts`, `coherence/builtin.ts`,
   `coherence/builtin/coerce_shared.ts`, `hir_ty_lowering/cmse.ts`, `check/check.oracle.test.ts`.
4. Stand-ins left for their owners (not on today's stop path, or in files another agent is editing): rustc_hir_typeck
   `decls.ts` `SizeSkeleton` `Pending` + `intrinsicck.ts` (`SizeSkeleton::compute`, `LayoutError::NormalizationFailure`,
   `skeleton_string`) → rustc_middle ty/layout.ts (`SizeSkeleton`, `LayoutError`); `fn_ctxt/checks.ts:1121` (`tcx.layout_of`
   for pattern-type literals); rustc_hir_analysis `check/check.ts:289` / `:2016` (the code after `tcx.layout_of` is commented
   out: `StaticOfUninhabitedType`, `check_transparent`'s non-trivial-field reasons); rustc_mir_build `thir/cx/expr.ts:469`
   (`(layout._0 as { size: Size }).size` → `layout._0.size`); local `FIRST_VARIANT` consts in rustc_hir_typeck `expr.ts`,
   `expr_use_visitor.ts`, rustc_middle ty/adt.ts, ty/consts/valtree.ts (→ rustc_abi `FIRST_VARIANT`).
5. `Size.raw` is a `number` (earlier PORT "byte sizes < 2^53"), but rustc accepts types up to `obj_size_bound` (2^61 on 64-bit
   targets, e.g. `[u8; 1 << 60]`): lane abi-lib / ty-utils-layout should keep that in mind (an overflow ICE test would expose it).
