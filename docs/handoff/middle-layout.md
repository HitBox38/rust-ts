# Handoff: middle-layout (M3b, layout fill lane 4 of 5): rustc_middle ty/layout.rs rest

Branch `lane/middle-layout`, base `6a5519cc` (lane/layout-contract), no merges. No baselines, oracle outputs, suites,
`harness/`, `scripts/`, `tools/` or `UPSTREAM.json` touched; nothing in rustc_hir_typeck.

## Files touched
- `src/rustc_middle/ty/layout.ts`: every one of the 29 `// stub:`s of the split table, row 4, is ported in place (stub comment
  → `// rustc:` marker). The nested `field_ty_or_layout` (:854) now sits inside `ty_and_layout_field`, as upstream; the
  module-level stub is gone (`TyMaybeWithLayout` stays a module-level type, as the contract declared it).
- `src/rustc_ty_utils/layout_contract.test.ts`: stub count 168 → **139** (fn count 320 unchanged). Re-pinned checks, with no
  assertion weakened: the old `SizeSkeleton::compute` / `discr_range_of_repr` / `ty_and_layout_field` "stops as UNPORTED with
  null args" checks are replaced by (a) the in-process test: `SizeSkeleton::compute(u16)` and
  `TyAbiInterface_Ty.ty_and_layout_field((u32,), cx, 0)` reach `tcx.layout_of` and stop at `layout_of_uncached`, plus real
  checks of `is_tuple` / `is_unit` / `is_adt` / `is_never` / `same_size`; (b) a new pure test that checks
  `discr_range_of_repr` (repr(Rust) / repr(C) / repr(isize), negative ranges, the "No type can represent .." panic),
  `FloatExt::from_float_ty` and `ValidityRequirement` Display. Note: in the in-process test each check uses a type the earlier
  checks have not queried, because a query that `Unported` leaves unfinished counts as a cycle the next time (FatalError).
  (Lanes 1-3 and 5 also edit this count line, so expect merge conflicts. The final count = 168 minus everything filled.)

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_middle/src/ty/layout.rs`: **61/61** (was 32/61).
- rustc_middle 2233/3369 (was 2204); TOTAL 16553/25518 (was 16524). `bun scripts/coverage.ts --check`: markers ok (17072).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000`: 5361 tests, 5348 pass, 1 skip, 12 fail. These are the same 12
  failures the layout-contract handoff found at its base (rustc_infer contract, fnsugg_b plus_eq, checks_b ×3, std result.test,
  wfcheck_a/b, compare_impl_item e0053/e0326, suggestions_b ×2). None is in a file this lane touched.
- The contract test is green (6 tests). rustc_middle `ty/print` tests: 24/24 (same as base).
- `rustc_middle/ty/layout.ts`, `rustc_middle/lib.ts`, `rustc_ty_utils/lib.ts`, `rustc_abi/lib.ts`, `rustc_hir_typeck/lib.ts` and
  `rustc_driver_impl/lib.ts` each load cleanly as a fresh entry point.

## Samples (lane vs base `6a5519cc`, `RUST_TS_AGENT=middle-layout` for both, so the samples are the same)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-114009-middle-layout-rfca` | 41 / 0 / 5 / 0 | `20261021-113951-middle-layout-mxkq` | 41 / 0 / 5 / 0 |
| thirdump-minicore (46) | `20261021-114032-middle-layout-f67o` | 41 / 0 / 5 / 0 | `20261021-114003-middle-layout-73w6` | 41 / 0 / 5 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-114046-middle-layout-19un` | 290 / 0 / 10 / 0 | `20261021-114343-middle-layout-otu5` | 290 / 0 / 10 / 0 |
| hir-tree `--sample 300` | `20261021-114218-middle-layout-uo4t` | 299 / 0 / 1 / 0 | `20261021-114529-middle-layout-8v1v` | 299 / 0 / 1 / 0 |

Every case has the same status and the same unported text in lane and base (compared case by case). No new DIFF. The layout stops are still at
`layout_of_uncached` (lane ty-utils-layout), which runs before any code from this lane.

## `unported(...)` left (all in `src/rustc_middle/ty/layout.ts`)
1. `Size beyond 2^53 (rustc_middle::ty::layout::SizeSkeleton::compute_inner, array)`: **the one Size-beyond-2^53 site**.
   The `u64::checked_mul` of an array skeleton runs in `bigint`: a product ≥ 2^64 → `SizeOverflow`, as upstream; a product in
   [2^53, 2^64) stops here instead of building a wrong `Size`.
2. `rustc_middle::ty::vtable::vtable_min_entries (...)`: inside `ty_and_layout_field`'s `mk_dyn_vtable` (the metadata field of
   a `&dyn Trait` / `*const dyn Trait` pointer). ty/vtable.rs is not ported. The `principal.map(instantiate_bound_regions_with_erased)`
   argument is never computed, so nothing observable happens before the stop.
3. `codegen_handle_fn_abi_err`: both `span_bug!` arms (messages need `PolyFnSig` Display / `ty::Instance` Display; `Instance` is
   `Pending`, M4). The `SizeOverflow` / `InvalidSimd` arm (emits the `Spanned<FnAbiError>` diagnostic) is real.
4. `Instance_def_id`: a local helper for `instance.def_id()` (only on the error path of `fn_abi_of_instance*`, when the span is
   dummy).
5. Unchanged from the contract: `debug_FnAbiRequest`.

## FnAbi part
`FnAbiOf_provided.fn_abi_of_fn_ptr` / `fn_abi_of_instance_no_deduced_attrs` / `fn_abi_of_instance`, `FnAbiError::into_diag`
and `codegen_handle_fn_abi_err` are ported even though `FnAbi` is still `Pending1` (M4). They call the generated queries,
whose values are `Result<unknown, FnAbiError>` and are cast to `Result<FnAbi<Ty>, FnAbiError>`, the precedent set by ty/mod.rs
`TyCtxt_fn_abi_of_instance`. They run only once a codegen-side `FnAbiOfHelpers` implementor exists. Today nothing reaches
them, and the `fn_abi_of_*` providers (rustc_ty_utils abi.rs) are not registered.

## `// PORT:` decisions
- `abi::Integer` ordering (`cmp::max`, `<` / `<=` in `discr_range_of_repr`): a local `Integer_discriminant` rank (declaration
  order) + `Integer_max`. **For root / lane abi-lib:** move it to rustc_abi lib.ts as `Integer_discriminant` (PORTING §5
  "`<Enum>_discriminant`"); layout.rs (`layout_of_enum`, abi-layout-b) needs the same ordering.
- `i128::cast_unsigned` / `u128::cast_signed` → `BigInt.asUintN(128, ..)` / `BigInt.asIntN(128, ..)`.
- `Size` comparisons (`==`, `<=`) compare `.bytes()` (derived `PartialEq` / `PartialOrd` of `Size`). rustc_abi has no
  `Size_eq` / `Size_lt`; if abi-lib adds them, repoint.
- `layout.size * (flag as u64)` → `layout.size.mul(flag ? 1 : 0)` (`Mul<u64> for Size`, abi-lib's stub).
- `SizeSkeleton::compute_inner`'s lazy `fields` iterator is unrolled into the loop body, so each field skeleton is computed
  only when it is reached (an early `Err` stops the rest, as upstream).
- `state_tys(..).nth(index).unwrap().nth(i).unwrap()` and `upvar_tys()[i]` / `tys[i]` / `fields[FieldIdx]` use the local
  helpers `iter_nth` / `index_slice`, which panic with Rust's messages.
- `variant.field(cx, i).to_result().ok()` is `MaybeResult_T.to_result(field)` (`impl MaybeResult<T> for T`).
- `tcx.fn_abi_of_instance(..)` on a `TyCtxtAt` is the inherent `TyCtxt::fn_abi_of_instance` reached through `Deref`
  (`tcx.deref().fn_abi_of_instance(..)`); there is no query with that name.
- Init order: `rustc_target::spec` (`PanicStrategy::unwinds`), `ty::sty` (`CoroutineArgsExt`) and `crate::traits`
  (`ObligationCause::dummy`) are loaded lazily (`require`, as `pretty()` is). A plain value import of `rustc_target/spec/mod.ts` broke
  init order (`Cannot access 'Os' before initialization` in the `ty/print` oracle tests).
- `bug!` / `assert_eq!` messages are built only on failure (contract convention). They use `debug_TyAndLayout_Ty` (`{:?}` /
  `{:#?}`), `debug_LayoutError`, `debug_Variants` and `display_Ty`.

## Stubs in other lanes this code calls (each stops there until filled)
- abi-lib: `Size::{add, sub, mul}`, `Scalar::primitive`, `Primitive::size`, `FieldsShape::{count, offset}`.
- abi-layout-a: `LayoutData::{scalar, uninhabited_variant, for_variant}`.
- abi-layout-b: `TyAndLayout::{for_variant, field, pointee_info_at}`.
- ty-utils-layout: `layout_of_uncached` (every `tcx.layout_of`).

## For root
1. **Stand-ins to repoint (rustc_hir_typeck; not edited here because fixer merge-w19 owns those files):**
   - `rustc_hir_typeck/decls.ts:131` `SizeSkeleton = Pending<"rustc_middle::ty::layout::SizeSkeleton">` → import
     `SizeSkeleton` (and `LayoutError`) from `rustc_middle/ty/layout.ts`.
   - `rustc_hir_typeck/intrinsicck.ts`: `skeleton_string` (:61, `unported("rustc_middle::ty::layout::SizeSkeleton / LayoutError
     (M4)")`); `LayoutError::NormalizationFailure` (:77-79, now a plain `{ $: "NormalizationFailure", _0, _1 }`); the transmute
     check (:92-96, `SizeSkeleton::compute(from/to, tcx, typing_env, span)` + `same_size`). These can now be ported against
     `SizeSkeleton.compute` / `SizeSkeleton.same_size`. They will stop at `layout_of_uncached` until lane ty-utils-layout lands.
2. `Integer_discriminant` → rustc_abi lib.ts (see the PORT decisions).
3. Record: "middle-layout: rustc_middle ty/layout.rs fully ported (61/61), FnAbi provided fns included (query values cast as
   in `TyCtxt_fn_abi_of_instance`); one Size > 2^53 stop (SizeSkeleton array); rustc_target::spec is lazily required from
   ty/layout.ts (init order)."
