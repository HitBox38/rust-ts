# Handoff: hir-ty-lowering-c (wave 16, M3): hir_ty_lowering/bounds.rs, generics.rs, dyn_trait.rs

Branch `lane/hir-ty-lowering-c` (from `5171055`, the hirtylowerer-contract tip; no merges).

## Files touched
All under `src/rustc_hir_analysis/hir_ty_lowering/`:
- `generics.ts`: generics.rs complete (the 5 free fns + the nested `LifetimeArgsIssue::into_diag`).
- `bounds.ts`: bounds.rs complete (`CollectedBound::any`, `CollectedSizednessBounds::any`, 5 free fns, the 9
  `impl dyn HirTyLowerer` methods, the hand class `GenericParamAndBoundVarCollector` + its `TypeVisitor` impl).
  The `unported_methods(..)` call is gone.
- `dyn_trait.ts`: dyn_trait.rs complete (the 12 `impl dyn HirTyLowerer` methods, the nested
  `TraitObjectWithoutDyn::into_diag`, `replace_dummy_self_with_error`). The `unported_methods(..)` call is gone.
- `lowering_c.test.ts` (new): 21 tests through the contract (see "Tests").

No other file is touched: decls.ts, mod.ts, errors.ts and the `.gen.ts` files are unchanged. No local `declare module`
on decls.ts was needed.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/hir_ty_lowering/<f>.rs`:
| file | ported |
|---|---|
| bounds.rs | 20/20 |
| generics.rs | 6/6 |
| dyn_trait.rs | 14/14 |

`bun scripts/coverage.ts --check`: `markers ok (12301; vendor 3888)`.

## Tests
`src/rustc_hir_analysis/hir_ty_lowering/lowering_c.test.ts`, 21 pass. Diagnostic texts are compared byte for byte with
the pinned nightly (`rustc +nightly-2026-10-11 -Zui-testing --edition 2021 --emit=metadata`), the programs are listed in
the file header. Each test rebuilds the HIR / `ty::Generics` rustc has at that point and calls the ported fn as its
caller does (a `HirTyLowerer` over a test vtable; methods of lanes -a/-b/-d are shadowed per object when needed):
- **E0747** through `lower_generic_args`: "type provided when a constant was expected" + the braces suggestion
  (`S<u8>`), "constant provided when a type was expected" (`T<3>`), the late-lifetime path
  (`S<u8, 'static>`: `(Some(arg), None)` + `force_infer_lt`), and the note + "reorder the arguments" help of
  tests/ui/const-generics/argument_order.stderr. All match.
- **E0794** through `check_generic_arg_count_for_value_path` (`f::<'static>` with a late-bound `'a`): matches, including
  the note span. The `LATE_BOUND_LIFETIME_ARGUMENTS` lint path (method-call position) is checked by recording the
  `emit_node_span_lint` call (lint levels are not reachable from a unit test).
- "bound modifier `?` can only be applied to `Sized`" (`require_bound_to_relax_default_trait`, `T: ?Send`): matches.
- `lower_generic_args` parent args / `Self` / inference / explicit-late-bound skipping; `check_generic_arg_count` correct
  counts, `infer_args`, and the two E0107 stops (exact unported text).
- bounds: `any`, `search_bounds_for` / `collect_bounds` / `collect_sizedness_bounds` (inline + where-clause bounds),
  `add_trait_bound` order, `add_implicit_sizedness_bounds` (default `Sized`, `?Sized` -> `MetaSized`, explicit bounds,
  trait defs, `PointeeSized`, auto traits, `#![rustc_no_implicit_bounds]`) and `add_default_traits` on real interned
  clauses, `lower_bounds` (trait / outlives / use, `SelfTraitThatDefines`, `ConstIfConst`),
  `GenericParamAndBoundVarCollector`.
- dyn_trait: `replace_dummy_self_with_error`, `lower_trait_object_ty` up to its first unported call,
  `lower_trait_object_lifetime`, `prohibit_or_lint_bare_trait_object_ty` with no bounds.

**PENDING (end to end).** No difftest suite reaches these fns yet: `type_of` / `generics_of` / `fn_sig` / ... are
collect-a/-b stubs and typeck is wave 17+. Once a suite lowers types:
- E0107 (`WrongNumberOfGenericArgs`): every wrong-count case stops as
  `rustc_hir_analysis::diagnostics::wrong_number_of_generic_args::WrongNumberOfGenericArgs::new (E0107, lifetimes)` or
  `... (E0107, types/consts)`.
- Every `dyn Trait` type stops as `rustc_trait_selection::traits::util::expand_trait_aliases`.
- Bare trait objects (E0782 / `BARE_TRAIT_OBJECTS`) whose suggestions need a fresh type param name stop as
  `rustc_trait_selection::error_reporting::traits::suggestions::NextTypeParamName::next_type_param_name`.

## Samples
- `RUST_TS_AGENT=hir-ty-lowering-c bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 99 MATCH / 0 DIFF /
  1 UNPORTED / 0 CRASH (run `20261014-121718-hir-ty-lowering-c-o463`). The UNPORTED is the pre-existing delegation case
  at `rustc_hir_analysis::collect::fn_sig`.

## `unported(...)` left
- generics.rs `check_generic_arg_count`: both `WrongNumberOfGenericArgs::new` sites (texts above).
  diagnostics/wrong_number_of_generic_args.rs is unassigned (contract split table: wave 19 or after -d).
- dyn_trait.rs (rustc_trait_selection is not ported):
  - `rustc_trait_selection::traits::util::expand_trait_aliases` (`lower_trait_object_ty`);
  - `rustc_trait_selection::error_reporting::traits::report_dyn_incompatibility` (`lower_trait_object_ty`);
  - `rustc_trait_selection::traits::wf::object_region_bounds` (`compute_object_lifetime_bound`);
  - `rustc_trait_selection::diagnostics::AssocTypeWithSameName` (`prohibit_or_lint_bare_trait_object_ty`);
  - `rustc_trait_selection::error_reporting::traits::suggestions::NextTypeParamName::next_type_param_name`
    (`add_generic_param_suggestion`).
- Reached through other lanes' placeholders (not mine): mod.ts (-a/-b: `lower_poly_trait_ref`, `lower_lifetime`,
  `probe_*`, `lower_generic_args_of_assoc_item`, `lower_ty`, `lower_const_arg`, `validate_late_bound_regions`,
  `prohibit_generic_args`, `lower_mono_trait_ref`, `resolve_type_relative_path`), errors.ts (-d:
  `prohibit_assoc_item_constraint`, `check_for_required_assoc_items`, `report_missing_generic_params`,
  `report_missing_self_ty_for_resolved_path`, `report_trait_object_*`).

## PORT decisions (please record)
1. generics.rs `lower_generic_args`: the two `Peekable` iterators are the arrays plus a cursor (`pi`, `ai`); `peek()` is
   `xs[i]`, `next()` is `i++`; `args_iter.clone().is_sorted_by_key(..)` scans from the cursor. `SmallVec` capacity is
   dropped.
2. Nested manual `impl Diagnostic`s (`LifetimeArgsIssue`, `TraitObjectWithoutDyn`) are local factories returning a
   `Diagnostic` object; the `into_diag` marker sits on the object method.
3. `FxIndexMap<(DefId, PolyTraitRef), (PolyProjectionClause, Span)>` and `FxIndexSet<(DefId, PolyTraitRef)>` are
   `KeyedMap` / `KeyedSet` on `intern_key` (derived `Hash`+`Eq`); `IndexMap::insert` is `get` + `set` (the position of
   an existing key is kept). Derived `PartialEq` on binders (`anonymize_bound_vars(proj) != ..`, `Vec::dedup`) compares
   `intern_key`s. `FxHashSet<DefId>` / `FxIndexSet<DefId>` are `DefIdSet`, `FxIndexSet<u32>` a `Set<number>`.
4. `GenericParamAndBoundVarCollector` (types.sets.json `hand`) is a class implementing `TypeVisitor<ControlFlow<
   ErrorGuaranteed>>`; `depth.shift_in/out` reassign the field (`DebruijnIndex.shifted_in/out`), as `ValidateBoundVars`.
5. D4 descriptors defined locally from the generated fns: `TraitRef`, `TraitClause`, `ProjectionClause`,
   `ExistentialPredicate`; `relate_AliasTerm` / `relate_AliasTy` (rustc_type_ir relate.ts) serve as the
   `TypeFoldable` descriptors of `AliasTerm` / `AliasTy`.
6. `TyCtxt` passed to rustc_type_ir constructors that take the `Interner` goes through rustc_type_ir predicate.ts's
   `as_interner` (as print/mod.ts does).
7. Query values typed `unknown` in queries.gen.ts are cast at the call: `generics_of` (`Generics`), `type_of`
   (`EarlyBinder<Ty>`), `fn_sig` (`EarlyBinder<Binder<FnSig>>`), `associated_items` (`AssocItems`),
   `generics_require_sized_self` / `is_dyn_compatible` (`boolean`), `def_ident_span` (`Span | undefined`).
8. `impl Display for Binder<Term>` (`format!("{}", proj.term())`) is a local `display_Binder_Term`: rustc_type_ir
   ir_print.ts's `display_Binder` with `TyCtxt`'s blanket `IrPrint` (`IrPrint_print` over `print_Binder(.., print_Term,
   fold_Term)`).
9. Init order: dyn_trait.ts imports `rustc_middle/lib.ts` (side effect) before rustc_middle's ty/print modules; without it
   the module fails as a fresh-process entry point (TDZ in rustc_middle's printer). Every rustc_hir_analysis module
   still loads as an entry point.
10. `assert_eq!(&args[..], &[])` compares lengths (the debug text renders the list with `debug_GenericArg`).

## For root
1. **Decls mismatch (rustc_middle ty/decls.ts):** `collect_constrained_late_bound_regions` /
   `collect_referenced_late_bound_regions` are declared `Set<BoundRegionKind>` but return a `KeyedSet` (ty/visit.ts), and
   `HirTyLowerer.validate_late_bound_regions` (decls.ts) takes `KeyedSet<BoundRegionKind>`. bounds.ts / dyn_trait.ts cast
   (`as KeyedSet<BoundRegionKind>`, `// PORT:`). Suggest declaring the return type `KeyedSet<BoundRegionKind>`.
2. rustc_trait_selection fns used here (list above) are small and self-contained except `report_dyn_incompatibility`;
   `expand_trait_aliases` (traits/util.rs:34, ~55 lines) gates every `dyn Trait` lowering.
3. diagnostics/wrong_number_of_generic_args.rs gates every E0107.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok (above); `--missing` reports 0 for the three files.
- `bun test src/rustc_hir_analysis`: contract.test.ts 10/10, lowering_c.test.ts 21/21.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run".

## Test run
FULL_TEST_RESULT
