# Handoff: collect-a (wave 16, M3): collect.rs, collect/generics_of.rs, collect/type_of.rs (+ opaque.rs), 3 lib.rs fns

Branch `lane/collect-a` (from `lane/hirtylowerer-contract` 5171055, no merges). Contract: docs/handoff/hirtylowerer-contract.md.

## Files touched
All under `src/rustc_hir_analysis/`. No other lane's file, no decls.ts, no generated file.
- `collect.ts`: every collect.rs fn. `ItemCtxt` statics + 10 methods, `HirTyLowerer_ItemCtxt` (16), the 26 free fns
  (`adt_def`, `trait_def`, `fn_sig`, `impl_trait_header`, ...), `HirPlaceholderCollector` (class, extends
  `hir.intravisit.Visitor`), `FieldUniquenessCheckContext` / `NestedSpan` / `FieldDeclSpan` methods, the nested
  `outlives_bounds` and `ReprCIssue::into_diag`. The `unported_methods(..)` calls are gone.
- `collect/generics_of.ts`: `generics_of` (with the nested `GenericParametersForbiddenHere::into_diag`),
  `param_default_policy`, `has_late_bound_regions` (with `LateBoundRegionsDetector` and the inner fn),
  `AnonConstInParamTyDetector` (class).
- `collect/type_of.ts`: the 8 fns and `HasTait` (nested class in `type_alias_is_checked`).
- `collect/type_of/opaque.ts`: the 3 fns and `TaitConstraintLocator` (class, `NestedFilter = All`).
- `lib.ts`: `check_c_variadic_abi`, `lower_ty`, `lower_const_arg_for_rustdoc` (`check_crate` stays, wave 17).
- New tests: `collect.test.ts`, `collect_test/{run.ts,generics.rs,misc.rs,generics.expected.txt,misc.expected.txt}`.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| file | ported |
|---|---|
| collect.rs | 64/64 |
| collect/generics_of.rs | 10/10 |
| collect/type_of.rs | 9/9 |
| collect/type_of/opaque.rs | 12/12 |
| lib.rs | 4/5 (`check_crate`: wave 17, not this lane) |

`bun scripts/coverage.ts --check`: markers ok (12358; vendor 3888).

## Tests
- `collect.test.ts` runs the real driver to `after_expansion`, lowers the crate, and prints per local DefId what the
  tydump probe prints for `generics_of` / `type_of` (same `should_encode_*` predicates, `with_no_trimmed_paths!`).
  1. The report must equal `collect_test/<crate>.expected.txt`. A fact that reaches another lane's stub prints
     `STOP UNPORTED: <exact text>` (or `STOP FATAL`: a query poisoned by an earlier stop). These lines are the PENDING
     list below; when a lane lands, regenerate the expected file (check 2 then vouches for the new values).
  2. Against the probe (`$RUST_TS_DATA/target/probes/release/tydump`, tydump-nocore argv): same headers, every computed
     fact equal byte for byte. **generics.rs: 51 facts match, 0 differ; misc.rs: 22 match, 0 differ.** Covered:
     traits (`Self`), structs/enums/unions with type and const params, ctors, variants, fields, trait/impl assoc items,
     inherent impl fns, fn generics, type param defaults, `TyAlias`, foreign items, `ForeignTy` `type_of`, array-length and
     discriminant anon consts (MCG / NonTypeSystemAnon), inline `const {}` blocks (junk `<const_ty>` param).
  Runner deviations (documented in run.ts): no tydump prefix (facts on demand); `type_of` of `AnonConst` not asked
  (upstream feeds it during HIR ty lowering); no `defs_with_hir` filter (test crates are error-free).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src/rustc_hir_analysis`: 12 pass (contract 10 + 2 new).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run" below.

## Sample difftests (`RUST_TS_AGENT=collect-a`)
- `hir-tree-nocore --sample 100`: **100 MATCH / 0 DIFF / 0 UNPORTED / 0 CRASH** (run `20261014-122003-collect-a-unbk`).
- `hir-tree-nocore --filter delegation/`: 36 MATCH / 108 UNPORTED / 0 DIFF / 0 CRASH (run `20261014-122033-collect-a-8ocn`).
  All 108 now stop at `rustc_hir_analysis::hir_ty_lowering::HirTyLowerer::lower_fn_ty` (hir-ty-lowering-b), one step
  past this lane's `fn_sig` (was `rustc_hir_analysis::collect::fn_sig`). Same cases as before; none protected.

## PENDING (where the tests stop; exact `unported` texts)
From collect_test/*.expected.txt:
- `rustc_hir_analysis::hir_ty_lowering::HirTyLowerer::lower_ty` (hir-ty-lowering-b): `type_of` of fields, consts,
  statics, type aliases, impls, param defaults / const param types, assoc consts/types.
- `rustc_middle::ty::TyCtxt::repr_options_of_def (rustc_abi ReprOptions/ReprFlags/IntegerType/ScalableElt)`: `adt_def`,
  so `type_of` of every struct/enum/union and of unit/struct ctors and variants. **No lane owns this** (rustc_abi
  `ReprOptions`; see "For root" 1).
- `late_bound_vars_map provider (not ported)`, `is_late_bound_map provider (not ported)`,
  `named_variable_map provider (not ported)`, `opaque_captured_lifetimes provider (not ported)` (collect-rbv):
  `type_of` of fns / tuple ctors (`new_bound_fn_def`), `generics_of` of anything with lifetime params, of fns whose
  signature has a lifetime (`has_late_bound_regions`), of opaques.
- `opaque_types_defined_by provider (not ported)` (rustc_ty_utils, lane ty-utils): `type_of` of opaques.
- `defaultness provider (not ported)`: only the test runner's `should_encode_type(AssocTy)` predicate.
- `STOP FATAL` lines: queries poisoned by one of the above earlier in the same process.

## `unported(...)` left (all at the first use of a pending item, after the upstream statements before it)
- collect.ts
  - `placeholder_type_error_diag`: `rustc_trait_selection::error_reporting::traits::suggestions::NextTypeParamName::next_type_param_name`
    (so every `_` placeholder in an item signature stops here, via `ty_infer` / `ct_infer` / `report_placeholder_type_error`).
  - `lower_test_binder_body` / `_forall` / `_exists`: `rustc_hir_analysis::check::wfcheck::{TestBinderBody, WithWhereClauses / TestBinderForall, TestBinderExists} (pending, wave 17)`.
  - `lower_test_binder_constraint`: `rustc_infer::infer::SolverRegionConstraint::<build_and|build_or|new_ambig|new_true|new_leaf(..)> (pending: lane infcx-contract)`.
  - `dyn_compatibility_violations`: `rustc_trait_selection::traits::hir_ty_lowering_dyn_compatibility_violations`.
  - `recover_infer_ret_ty`: `rustc_infer::infer::TyCtxtInferExt::infer_ctxt (pending: lane infcx-contract)` (only when
    `make_suggestable` fails).
  - `suggest_impl_trait`: the two formatters are ported; the candidate loop is all `InferCtxt` / trait selection:
    `rustc_hir_analysis::collect::suggest_impl_trait (InferCtxt pending: lane infcx-contract)`.
  - stand-ins (not markers): `rustc_abi::ReprOptions::{discr_type, c}`, `rustc_abi::Size::{signed_int_min,
    signed_int_max, unsigned_int_max}` (check_enum_variant_types; as rustc_middle ty/util.ts / adt.ts do).
- collect/type_of.ts stand-ins: `rustc_hir_analysis::check::wfcheck::check_static_item (wave 17)`,
  `rustc_abi::ReprOptions::discr_type`.
- collect/type_of/opaque.ts stand-in: `rustc_trait_selection::opaque_types::report_item_does_not_constrain_error`.
- lib.ts: `check_crate` (unchanged, wave 17).

## PORT decisions (please record)
1. `HirPlaceholderCollector`, `AnonConstInParamTyDetector`, `TaitConstraintLocator` are classes extending
   `hir.intravisit.Visitor` (contract `hand` types); `LateBoundRegionsDetector` and `HasTait` are nested classes.
   The visitors with `type Result = ControlFlow<..>` set `override Result = VisitorResult.ControlFlow<..>()`.
2. Methods of the generated `NestedSpan` / `FieldDeclSpan` / `FieldUniquenessCheckContext` (collect.gen.ts) are
   module-private free fns `<Type>_<method>` with markers (`FieldDeclSpan_from_Span`, `..._from_NestedSpan`, ...),
   not prototype extensions: all are private to collect.rs.
3. `seen_fields` is a `KeyedMap` keyed by `Ident`'s `Eq` (name + `SyntaxContext`), a local `Ident_key` (same body as
   rustc_resolve's; rustc_hir_analysis does not depend on rustc_resolve).
4. The test-binder `FxIndexSet<(Clause, Span)>` is a `KeyedSet` keyed by `intern_key`.
5. `usize::MAX` depth limit (`select_inherent_assoc_candidates`) is `Number.MAX_SAFE_INTEGER`.
6. `rbv::ResolvedArg` is still rustc_middle's `PendingEnum`: `LateBoundRegionsDetector::visit_lifetime` matches it by tag
   and reads `LateBound`'s debruijn as `_0` (collect-rbv decides the real shape; check this site when it lands).
7. `generics_of` imports `early_bound_lifetimes_from_generics` statically from `../collect.ts` (`super::`), and type_of.ts
   imports `HirPlaceholderCollector` / `bad_placeholder` / `ItemCtxt` from it: a module cycle used inside bodies only.
   All modules import rustc_hir only through `rustc_hir/lib.ts` (a direct `def.gen.ts` import TDZs at load).
8. `#[instrument]`, `debug!`, `trace!` (tracing) are dropped; `debug_assert*!` are comments.

## For root
1. **Blocker without a lane:** `TyCtxt_repr_options_of_def` (rustc_middle ty/mod.ts) stops on rustc_abi's
   `ReprOptions` / `ReprFlags` / `IntegerType`. `adt_def` needs it, so every ADT `type_of`, `check_enum_variant_types`,
   discriminant types, and everything downstream (wfcheck, typeck) stays UNPORTED after all wave-16 lanes land.
   Suggest a small rustc_abi lane (`ReprOptions` + `Size::{signed_int_min, signed_int_max, unsigned_int_max}`).
2. `rustc_middle/ty/typeck_results.ts` still types `hidden_types` values as `Pending<"DefinitionSiteHiddenType">`;
   ty/mod.ts has the real class. opaque.ts casts at its two reads (`PORT` comment). Re-export the real type there.
3. rustc_trait_selection fns this lane calls (not ported anywhere): `NextTypeParamName::next_type_param_name`
   (small; blocks every `_`-in-signature diagnostic), `hir_ty_lowering_dyn_compatibility_violations`,
   `report_item_does_not_constrain_error`.
4. When infcx-contract merges: fill `suggest_impl_trait`'s loop, `recover_infer_ret_ty`'s `infer_ctxt()` and
   `lower_test_binder_constraint`'s `SolverRegionConstraint` arms (each stop names what is missing).
5. When collect-rbv / hir-ty-lowering lanes merge: regenerate `collect_test/*.expected.txt`
   (`bun src/rustc_hir_analysis/collect_test/run.ts --target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>
   --edition=2021 <crate>.rs > <crate>.expected.txt` in that directory); collect.test.ts's probe check then verifies
   the new facts. Raise the `min_matched` numbers in collect.test.ts accordingly.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok.

## Test run
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4500 pass, 1 skip (pre-existing linux-only), 0 fail
  (4501 tests, 272 files, 1403 s), including contract.test.ts 10/10 and collect.test.ts 2/2.
