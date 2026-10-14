# Handoff: ty-sty (wave 15, M3): rustc_middle ty/sty.rs

Branch `lane/ty-sty` (from `ab2cdfc`, no merges). Commits: the port; repointing tests / the print oracle runner; the
oracle test; a fix-up (assert message, `into_MultiSpan`, match tidy); this handoff.

## Files touched
- **Ported:** `src/rustc_middle/ty/sty.ts` (was ty-contract's stub). Every fn of sty.rs in upstream order, with markers:
  - `Article` (trait + `Article_TyKind`), `CoroutineArgsExt` (companion with the consts, `variant_range`,
    `discriminant_for_variant`, `discriminants`, `variant_name`, `discr_ty`, `state_tys`);
  - companions `UpvarArgs`, `InlineConstArgs`, `ParamTy`, `ParamConst` (`ParamLike::index`, `new`, `for_def`, `to_ty`,
    `span_from_generics`, `find_const_ty_from_env`);
  - all `Ty::new_*` statics, the `impl inherent::Ty for Ty` block, every `Ty` helper (`is_*`, `builtin_deref`,
    `sequence_element_type`, `fn_sig`, `discriminant_ty`, `ptr_metadata_ty*`, `has_trivial_sizedness`, `walk`, ...);
  - `impl inherent::Tys for &List<Ty>` (`RawList.prototype.inputs` / `output`);
  - `impl inherent::Symbol for Symbol` as the const `Symbol_inherent: Symbol_static`.
- **New tests:** `src/rustc_middle/ty/sty.test.ts` (13 tests) and `src/rustc_middle/ty/sty_oracle/`. That directory holds
  `probe.rs` (a rustc-dev program, the same pattern as print_oracle/probe.rs), `empty.rs` (its input) and
  `sty.stdout` (the fixture; `REGEN=1 bun test src/rustc_middle/ty/sty.test.ts` rebuilds it).
- **Edited outside sty.ts.** The brief asked to remove the stand-ins for `Ty::new_*`, `Region::flags` and `Tys` and to
  repoint their callers:
  - `ty/print/print_oracle/run.ts` (ty-print-a's):
    - `install_scaffolding` is a no-op. Everything it installed is now real: `Region::type_flags` / `flags` /
      `outer_exclusive_binder` (tyir-misc), and `inputs` / `output` / `is_unit` (this lane).
    - `types()` builds probe.rs's list with the same `Ty::new_*` calls the probe makes.
    - print.oracle.test.ts is still green.
  - `rustc_type_ir/tyir_kind.test.ts`, `tyir_misc_infer.test.ts`, `tyir_relate.test.ts`: dropped the `inputs` /
    `output` spies.
  - `tyir_relate.test.ts`: four expectations pinned `toThrow(Unported)` for `Ty::new_ptr`, `new_tup_from_iter`,
    `new_foreign` and `new_error`. They now check the real results: `Ok(..)` of the same interned type, and
    `new_tup_from_iter` stopping at the first `Err`.
  - `tyir_binder.test.ts`: dropped the `Ty::new_bound` spy. Its `Region` mocks are left as they are; they mirror the
    real port.
  - `ty/contract.test.ts` "a stub stops as UNPORTED": `Ty::is_bool` is ported, so the probe now uses
    `inhabited_predicate` (an inhabitedness/mod.rs stub).
- Not touched: decls.ts, `.gen.ts` files, tools/, harness/, scripts/.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_middle/src/ty/sty.rs`: **202/203**. The one missing entry is
`:1122 has_unsafe_fields`, the `inherent::Ty` impl that forwards to `Ty::has_unsafe_fields` in **ty/util.rs:1275 (lane
ty-util)**. TS has one method for both. ty-util's definition should carry both markers (`sty.rs:1122` and
`util.rs:1275`). Until then, sty.ts keeps an `unported_methods` stub for that one name. util.ts loads after sty.ts and
overwrites it.

No fn was left out as MIR/codegen-bound; all of them are ported. The MIR-bound ones stop UNPORTED at runtime, at
`tcx.coroutine_layout` and the `CoroutineLayout` stand-ins:
- `CoroutineArgsExt::{variant_range, discriminant_for_variant, discriminants, state_tys}`;
- the `Coroutine` arms of `Ty::variant_range` / `discriminant_for_variant`.

`bun scripts/coverage.ts --check`: markers ok (11252; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`. Full run on the first commit: 4288 pass, 1 skip
  (pre-existing linux-only), 4 fail. The 4 failures were the stub-pinning expectations listed above, which are now
  updated. After the fixes: `bun test src/rustc_middle/ty src/rustc_type_ir` 226 pass / 0 fail, and
  `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_middle/ty/print` 24 pass / 0 fail. The other suites did not change
  after the first run.
- Fresh-process `import()` of every module under `rustc_type_ir/`, `rustc_middle/ty/` and `rustc_middle/traits/` works.
  Three modules fail, and they fail the same way on the base commit: `print/mod.ts` and `print_oracle/test_printer.ts`
  (documented TDZ), and `pretty_oracle/run.ts` (a script that needs arguments).
- `RUST_TS_AGENT=ty-sty` difftest samples:
  - **hir-tree-nocore --sample 200**: 199 MATCH, 0 DIFF, 1 UNPORTED (`20261014-072037-ty-sty-agqe`). The stop is
    `delegation/self-coercion-static-free.rs` at `TyCtxt::is_method`, which was already there.
  - **expanded --sample 100**: 99 MATCH, 0 DIFF, 1 UNPORTED (`20261014-072107-ty-sty-obzt`). The stop is
    `error-codes/E0565.rs` at `Location::caller`. It was already there and is not in the protected set.

## Oracle test (sty.test.ts)
- probe.rs builds 58 types with rustc's own constructors: every `new_*` that needs no `AdtDef` / `DefId` path, the
  `inherent::Ty` statics, and `from_(coroutine_)closure_kind`. For each type it prints:
  - the Display;
  - which of 44 predicates hold, plus `has_trivial_sizedness(Sized / MetaSized)`;
  - `ty_vid`, `float_vid`, `ref_mutability`, `builtin_deref(true/false)`, `builtin_index`, `primitive_symbol`,
    `opt_tuple_fields`, `to_opt_closure_kind`, `sequence_element_type` and `discriminant_ty`;
  - the types `Ty::walk` visits.
- It also prints identities (pre-interned reuse, `new_tup([]) == unit`, `new_static_str`), `tuple_fields`, `Tys::inputs`
  / `output`, `contains` on itself, `CoroutineArgsExt::variant_name(0..6)` and `Article`.
- The port reproduces the fixture byte for byte. Display goes through ty-print-b's `FmtPrinter`, except for `fn(..)`
  types. `FmtPrinter` names binder regions and stops UNPORTED at `TypeVisitable for &List<Ty>` (generic_args.rs, lane
  ty-args), so those print through ty-print-a's `TestPrinter`, as the print oracle runner does.
- `unsafe<> i32` is not in the fixture: neither printer prints `unsafe<..>` yet. `FmtPrinter` needs structural_impls'
  `super_visit_with`, and `TestPrinter` drops the binder. Its kind and helpers are checked in a unit test instead.

## `unported(...)` left (all stand-ins at the end of sty.ts, module-local, not markers)
- **`AdtDef` (pending, lane ty-adt-assoc):**
  - `did`, `is_enum`, `is_union`, `is_phantom_data`, `is_unsafe_cell`, `is_box`, `is_pin`, `repr`, `flags`,
    `non_enum_variant`, `variant_range`, `discriminant_for_variant`, `sizedness_constraint`;
  - `AdtFlags::contains`, `VariantDef.fields`, `FieldDef::ty`.

  Every `Adt` arm stops UNPORTED, and so does `new_adt` (through `debug_assert_args_compatible(def.did(), ..)`).
  Non-ADT inputs never reach these stand-ins.
- **rustc_abi, not ported:** `ReprOptions::{simd, scalable (method and field), discr_type}`,
  `NumScalableVectors::{for_non_tuple, from_field_count}`.
- **ty-util:** `IntTypeExt::to_ty`.
- **ty-results:**
  - `ValTree::from_scalar_int` and `ScalarInt: From<u32>`, used by `new_field_representing_type`;
  - `Debug for ParamConst`;
  - reached through decls stubs: `Const::from_target_usize` (`new_array`) and `try_to_target_usize`.
- **ty-args:** `Generics::type_param` (`ParamTy::span_from_generics`).
- **ty-mod:** `ParamEnv::caller_bounds` and `Debug for ParamEnv` (`ParamConst::find_const_ty_from_env`).
- **middle-traits-thir:** `ObligationCause::dummy` (`ptr_metadata_ty_or_tail`, and so `ptr_metadata_ty` /
  `pointee_metadata_ty_or_projection` for pointees that are not trivially sized).
- **MIR (M4):** `CoroutineLayout.variant_fields` / `field_tys`.
- **Reached through other lanes' stubs:**
  - `debug_Ty` (mod.ts; structural_impls). This only affects ICE messages: `tuple_fields`, `to_opt_closure_kind`,
    `discriminant_ty`, `ptr_metadata_*`, `has_trivial_sizedness` and `expect_boxed_ty`. These panic as UNPORTED
    instead of an ICE.
  - `standin_fold_Ty.super_visit_with`: `contains` / `contains_closure` below the top level.
  - `as_closure` / `as_coroutine` / `as_coroutine_closure` / `type_at` (generic_args.rs). These are reached by
    `UpvarArgs`, `boxed_ty` / `pinned_ty` (only after `AdtDef_is_box` / `is_pin`) and the coroutine arms.
  - `has_unsafe_fields` (ty-util).

## PORT decisions (please record)
1. **`impl inherent::Ty for Ty`.** A trait fn that forwards to an inherent fn of the same name and signature is that
   one function. It carries both markers (PORTING §8; resolve / hir precedent):
   - statics `new_infer`, ...;
   - instance methods `tuple_fields`, `to_opt_closure_kind`, `discriminant_ty`;
   - `from_closure_kind` / `from_coroutine_closure_kind`.

   `inherent::Ty::new_param` is `Ty.ir_new_param` (ty-contract decision 5).
2. **Companions.** `CoroutineArgsExt` (an `#[extension]` trait on rustc_type_ir's `CoroutineArgs`) is a companion
   taking `self` first, with its associated consts as fields. The same holds for `UpvarArgs`, `InlineConstArgs`,
   `ParamTy` and `ParamConst`, each exported with its same-named type (tyir-kind decision 1). `Article` is an interface
   plus the impl object `Article_TyKind`. `inherent::Symbol` is the const object `Symbol_inherent`.
3. **`cfg!(debug_assertions)` blocks** are comments, because the oracle is a release build. This covers `new_adt`'s
   def-kind check, `new_dynamic`'s projection count and `new_coroutine_witness`'s args check. `debug_assert_matches!`
   in `new_fn_def` is also a comment. The unconditional `tcx.debug_assert_args_compatible(..)` calls are kept.
4. **Lazy iterators.** `filter_map` in `find_const_ty_from_env`, and `discriminants` / `state_tys`, are generators.
   `assert!(.., "{env:#?}")` formats its message only when the assertion fails.
5. **`print/pretty.ts`** (`Display for Ty`, used in `sequence_element_type`'s ICE) is loaded lazily with `require`.
   Generated rustc_type_ir modules reach sty.ts early for `debug_ParamTy` (merge-w15a decision 2 precedent).
6. **`new_tup_from_iter`** is an overload pair, `Iterable<Ty>` or `Iterable<Result<Ty, E>>` + `CollectAndApply_Result`
   (ty-contract decision 6).
7. **`ptr_metadata_ty_or_tail`** calls the declared `struct_tail_raw(ty, cause, normalize)`. Upstream's no-op
   `|| {}` callback has no parameter in the decls (ty-util's signature).
8. **`size_asserts`** (`static_assert_size!`) has no TS counterpart.

## For root
- **decls.ts.** These are `PORT(decls): pending root` casts in sty.ts:
  - `SizedTraitKind = Pending<..>` should re-export rustc_type_ir `solve/mod.ts`'s `SizedTraitKind`. That removes
    `to_decl_` / `from_decl_SizedTraitKind`.
  - `Discr = Pending<..>` should become `{ val: bigint, ty: Ty }` (util.rs, ty-util). That removes the cast in
    `Discr_new`.
- **ty_kind.ts PORT(decls) overload (tyir-kind decision 8).** decls.ts already declares `inputs` / `output` with
  `this: List<Ty>`, so the local overload in rustc_type_ir/ty_kind.ts is redundant and can be dropped.
- **At the ty-util merge:** add the marker `// rustc: compiler/rustc_middle/src/ty/sty.rs:1122 has_unsafe_fields`
  above util.ts's `has_unsafe_fields`, then delete the `unported_methods(.., ["has_unsafe_fields"])` line at the end
  of sty.ts's type utilities.
- **Stand-ins to repoint as their lanes land:** the list above. The AdtDef ones mirror the `AdtDef_*` stand-ins in
  print/pretty.ts, relate.ts and fast_reject.ts.
- **print_oracle/run.ts:** `install_scaffolding` can be deleted, together with its callers in print.test.ts and
  run.ts's `main`.
- **Probe.** `sty_oracle/probe.rs` could become a tools/probes probe.
