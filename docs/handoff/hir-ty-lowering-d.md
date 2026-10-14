# Handoff: hir-ty-lowering-d (wave 16, M3): rustc_hir_analysis hir_ty_lowering/errors.rs + cmse.rs

Branch `lane/hir-ty-lowering-d` (from `5171055`, the hirtylowerer-contract handoff; no merges).

## Files touched
- `src/rustc_hir_analysis/hir_ty_lowering/errors.ts`: errors.rs 22/22. The 16 `impl dyn HirTyLowerer` methods are assigned
  onto `HirTyLowerer.prototype` in upstream order (the `unported_methods(..)` call is gone); the 5 free fns fill the
  contract stubs in place (signatures of `Fns_hir_ty_lowering_errors` unchanged); the hand type `GenericsArgsErrExtend` is
  kept; the manual `impl Diagnostic for AmbiguityBetweenVariantAndAssocItem` is `AmbiguityBetweenVariantAndAssocItem_into_diag`
  + `_diagnostic` (rustc_passes/diagnostics.ts convention).
- `src/rustc_hir_analysis/hir_ty_lowering/cmse.ts`: cmse.rs 5/5 (signatures of `Fns_hir_ty_lowering_cmse` unchanged).
- `src/rustc_hir_analysis/diagnostics.ts`: diagnostics.rs:477 `MissingGenericParams::into_diag` (`MissingGenericParams_into_diag`
  + `_diagnostic`). The other manual impl (:2078 `UncoveredTyParam`, wave 17) is untouched.
- Tests (new): `src/rustc_hir_analysis/hir_ty_lowering/errors.oracle.test.ts`, `errors_oracle/run.ts` (test driver, not a
  port), `errors_oracle/cases/*.rs` (9 cases).
- No other file edited (decls.ts, mod.ts, bounds.ts, dyn_trait.ts, generics.ts, lib.ts untouched).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs`: **22/22 ported**.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs`: **5/5 ported**.
- `--missing compiler/rustc_hir_analysis/src/diagnostics.rs`: 1/2 (left: :2078 `UncoveredTyParam::into_diag`, wave 17).
- `bun scripts/coverage.ts --check`: `markers ok (12289; vendor 3888)`.

## Tests (`errors.oracle.test.ts`)
Oracle: the pinned rustc on each `errors_oracle/cases/<name>.rs` with `--edition 2021 --crate-type lib -Ainternal_features`
(stderr + exit code), run live in `beforeAll` (`scripts/lib/oracle.ts`; skip without the toolchain, failure under
`RUST_TS_REQUIRE_PROBES=1`). Every case's type checking emits exactly the errors.rs diagnostic(s) under test.
1. **End to end** (src/rust_ts/main.ts): all 9 are **PENDING** at `rust-ts: unported: rustc_interface::passes::analysis (M3+)`
   (exit 70); the test pins that exact line, so each entry must go when the driver reaches HIR ty lowering.
2. **In process** (errors_oracle/run.ts): from `after_expansion`, the case's errors.rs entry point is called with the
   arguments its upstream caller computes (cited per case in run.ts), through a test `impl HirTyLowerer` (`tcx`/`dcx`/
   `item_def_id`/`mod_id` as `ItemCtxt`'s; the rest stop). **9/9 byte-identical** stderr + exit code:
   - `e0223_prim` (`type A = u8::Foo;`): `report_unresolved_type_relative_path` -> `maybe_report_similar_assoc_fn` ->
     `report_ambiguous_assoc_item_path` (E0223 + "if there were a trait named `Example` .." suggestion; `u8` printed by the
     ported type printer). Scaffolding: lane -a's `probe_traits_that_match_assoc_ty` answers `[]` (no traits in the crate).
   - `e0109_prim`, `e0109_kinds` (`u8<'static, i32, 3>`: "lifetime, type and const arguments"), `e0109_lifetime` (`bool<'static>`),
     `e0109_param` (`type A<T> = T<u8>;`: `GenericsArgsErrExtend::Param` note): `report_prohibited_generic_args` +
     `generics_args_err_extend` (PrimTy / Param arms).
   - `e0229_prim` (`u8<Item = i32>`), `e0109_e0229_prim` (`u8<i32, Item = u8>`: two errors, "Some errors have detailed
     explanations"): `prohibit_assoc_item_constraint` (segment `None`). run.ts transcribes mod.rs:1995
     `prohibit_generic_args` (lane -a) as scaffolding for these.
   - `e0393` (`dyn Tr` with `trait Tr<T = Self>`: label, note, "explicitly specify" suggestion), `e0393_args`
     (`dyn Tr<'static>` with two missing params: "missing references to `T` and `U`"): `report_missing_generic_params` ->
     `MissingGenericParams::into_diag`.
   - Negative control: changing one label text in errors.ts fails the 5 E0109 in-process cases.
- Not reachable in process yet (they need ported queries / lanes): everything reading `type_of`, `generics_of`, `trait_def`,
  `associated_items`, `fn_sig`, `impl_trait_header`, `adt_def` (collect lanes), the lowering methods of lanes -a/-b/-c, the
  `TraitRefPrint*` binder printing (derive stand-ins below), `FulfillmentError` and dyn-compatibility (rustc_trait_selection),
  and all of cmse.rs (layouts, M4; also needs a thumbv8m target).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src/rustc_hir_analysis`: 29 pass (contract.test.ts 10/10, oracle 19/19).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4516 pass, 1 skip (pre-existing linux-only), 1 fail:
  `src/std/fmt.test.ts` "format_debug of a deep chain is linear in the output size", a timing test that flaked under load
  (file untouched; re-run alone: 3/3 pass).
- `RUST_TS_AGENT=hir-ty-lowering-d bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 99 MATCH / 0 DIFF /
  1 UNPORTED / 0 CRASH (run `20261014-124305-hir-ty-lowering-d-dn4z`); the UNPORTED is the pre-existing
  `StableHash without a TS impl` (transmutability/references/reject_extension.rs), not protected-set relevant to this lane.

## `unported(...)` left
All in stand-in fns at the end of each file (`// ==== stand-ins ..`); root replaces each when its owner lands.
- errors.ts:
  - `rustc_hir_analysis::hir_ty_lowering::AssocItemQSelf::to_string` (mod.rs:261, lane -a; becomes `AssocItemQSelf.to_string(qself, tcx)`);
  - `rustc_hir_analysis::hir_ty_lowering::LowerTypeRelativePathMode::def_kind_for_diagnostics` (mod.rs:285, lane -a);
  - `rustc_trait_selection::traits::FulfillmentError::root_obligation` (`FulfillmentError` is pending, wave 17);
  - `rustc_trait_selection::traits::dyn_compatibility_violations_for_assoc_item`;
  - `rustc_trait_selection::error_reporting::traits::report_dyn_incompatibility`;
  - `rustc_middle::ty::print::pretty::TraitRefPrintOnlyTraitPath: TypeVisitable|TypeFoldable (derive, codegen pending)` and the
    same for `TraitRefPrintSugared`: the D4 descriptors `Binder<TraitRefPrint*>` printing needs (`FmtPrinter` visits the
    binder to name regions). Reached by `report_ambiguous_assoc_item`, `check_for_required_assoc_items`,
    `report_trait_object_addition_traits`.
- cmse.ts (M4 layout): `rustc_abi::Layout::align`, `rustc_abi::Layout::size`,
  `rustc_abi::TyAndLayout::peel_transparent_wrappers_from_non_1zst`, `rustc_middle::ty::layout::LayoutCx::new`. Before
  any of them, `tcx.layout_of(..)` stops at its placeholder provider (`layout_of provider (not ported)`).
- Reached through other lanes' placeholders (not mine): the dyn methods `lower_ty`, `lower_const_arg`,
  `lower_generic_args_of_assoc_item`, `probe_traits_that_match_assoc_ty`; `bounds::check_assoc_const_binding_type`; the
  queries above.

## PORT decisions (please record)
1. **Query values typed `unknown`** in queries.gen.ts (`associated_items`, `associated_item`, `trait_def`, `impl_trait_header`,
   `type_of` (incl. `tcx.at(..)`), `fn_sig`, `generics_of`, `layout_of`) are cast at the call to the upstream type
   (`associated_items` through a local helper).
2. **Sorting**: `Vec<String>::sort()` is a stable sort with rustc_session's `str_cmp` (byte order); `Vec<Symbol>::sort()` in
   `check_for_required_assoc_items` compares the interned index (`Symbol`'s derived `Ord`), i.e. numerically;
   `sort_by_key(|(span, _)| span.lo_hi())` is a stable sort on `(lo, hi)`; `Vec::dedup` is a local helper.
3. **Maps**: `FxIndexMap<PolyTraitRef, Vec<Symbol>>` is a `KeyedMap(intern_key)` (insertion order); the
   `UnordMap<(Symbol, AssocTag), _>`s are `KeyedMap`s keyed `"<symbol>:<tag>"` (lookups only); the second `FxIndexMap<Symbol,
   usize>` a `Map`; `FxIndexSet<ProhibitGenericsArg>` a `Set` of the variant names; `SortedMap<OrdSpan, Vec<String>>` the ported
   `SortedMap` with `OrdSpan.cmp`, and `get_mut_or_insert_default` (not ported on `SortedMap`) is `get` + `insert` of a fresh
   array inline.
4. **Display of `Binder<TraitRefPrintOnlyTraitPath>` / `Binder<TraitRefPrintSugared>`** is `display_Binder(b, ir_print)` with
   the `IrPrint` impl built from `print_Binder(.., print_TraitRefPrint*, d_T)` (ty/print/mod.rs:423 through `IrPrint_print`);
   `tcx.short_string(b, err.long_ty_path(), ..)` uses the same `print_Binder` (cast to ty/decls.ts's pending `Print`, as
   pretty.ts's `as_decls_print`). `d_T` is the derive stand-in above.
5. **Let-chains** are nested `if`s with the same evaluation order (`lower_ty` before `features().gca()`; the snippet in
   `check_for_required_assoc_items` only when the first branch is not taken; `opt_item_name` once per match guard); tuple
   / slice matches are if-chains in arm order; `continue` inside a `match` in a loop stays `continue`.
6. **Spans**: equality is `===` (interned); `args.span_ext.lo() - BytePos(2)` is number arithmetic cast to `BytePos`.
7. **`simplify_type(tcx, ..)`** passes `tcx as unknown as Interner` (TyCtxt's `Interner` declaration is still incomplete,
   ty-print-a decision 13).
8. **`struct_span_code_err!` / `format!` messages** are pre-formatted template strings; `msg!` is rustc_errors' `msg(..)`
   with the literal's exact whitespace (the fluent selectors in `MissingGenericParams::into_diag` keep their indentation).
9. **cmse.rs layouts**: `LayoutError` is read through a local view `LayoutErrorView` (ty/layout.rs:253 shape) and built for
   `LayoutError::Unknown(ty)` (`tcx.arena.alloc` erased); `u64` sizes / alignments are `number` (cmse targets are 32-bit);
   `u64::next_multiple_of` is a local helper; `zip` iterates to the shorter length.
10. **`AmbiguityBetweenVariantAndAssocItem_into_diag`**: `Diag::new(dcx, level, "..")` takes the `&str` (`DiagMessage::Str`).

## For root
1. **Merge with lane hir-ty-lowering-a**: replace `AssocItemQSelf_to_string(qself, tcx)` and
   `LowerTypeRelativePathMode_def_kind_for_diagnostics(mode)` with -a's companion methods and delete the stand-ins.
2. **Codegen**: add `TraitRefPrintOnlyTraitPath` / `TraitRefPrintSugared` (pretty.rs:2981 / :3001) to a TypeFoldable /
   TypeVisitable set (ty-print-b "For root" asks the same); then replace `fold_TraitRefPrintOnlyTraitPath_` /
   `fold_TraitRefPrintSugared_` in errors.ts.
3. **rustc_trait_selection (wave 17)**: replace the three trait-selection stand-ins and `FulfillmentError`.
4. **M4**: replace cmse.ts's layout stand-ins and `LayoutErrorView` with ty/layout.rs's `LayoutError`.
5. **When the driver runs HIR ty lowering**: errors.oracle.test.ts's `PENDING` map must shrink (each case then compares end to
   end with the oracle); errors_oracle/run.ts's scaffolding (`TestLowerer`, the `prohibit_generic_args` transcription, the
   `probe_traits_that_match_assoc_ty` override) can go once `ItemCtxt` and lanes -a/-b/-c land.
6. No decls.ts change was needed.
