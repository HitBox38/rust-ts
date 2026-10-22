# Handoff: errrep-region (M3 wave 19, error reporting; row 11 of the errctxt-contract split table)

Branch `lane/errrep-region` (from integ `52b5e37d`, no merges). Commits: `abbaad61` port, `cb3036dc` oracle tests,
`9cdee8e6` trim_start fix (from the resumed session's review), this handoff. The first session hit an API usage limit
after `cb3036dc`; the resumed session re-reviewed every fn against upstream, re-ran all checks and wrote this file.

## Files touched (all assigned; nothing else edited)
- `src/rustc_trait_selection/error_reporting/infer/region.ts` (region.rs, 19/19)
- `src/rustc_trait_selection/error_reporting/infer/nice_region_error/mod.ts` (7/7), `util.ts` (5/5),
  `find_anon_type.ts` (7/7), `different_lifetimes.ts` (2/2), `named_anon_conflict.ts` (1/1)
- New test `src/rustc_trait_selection/error_reporting/infer/region.oracle.test.ts` + 6 cases in `region_oracle/cases/`.

Every stub was filled per "How to fill a stub": prototype assignments with markers, lane `unported_methods` lists
removed, free-fn stubs replaced by `export function`; `LifetimeReplaceVisitor` (local to `suggest_name_region`),
`FindNestedTypeVisitor` and `TyPathVisitor` are real classes (`rustc-type:` markers). No decls.ts signature was changed.

## Coverage
`bun scripts/coverage.ts --missing <file>`: region.rs 19/19, nice_region_error/mod.rs 7/7, util.rs 5/5,
find_anon_type.rs 7/7, different_lifetimes.rs 2/2, named_anon_conflict.rs 1/1. rustc_trait_selection 597 → 638/976 (+41);
TOTAL 15945/25518. `bun scripts/coverage.ts --check`: markers ok (16464; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_trait_selection --timeout=120000`: 78 pass, 0 fail (12 files; includes
  `errctxt_contract.test.ts`, which stays green, and the new oracle test).
- `region.oracle.test.ts` (6 cases: E0309 ×4, E0310, E0311 through `GenericBoundFailure` →
  `construct_generic_bound_failure`, run by the existing compare_impl_item / wfcheck_b drivers): each case must either
  equal the pinned rustc's stderr + exit code byte for byte, or stop at exactly one of two PENDING placeholders owned by
  other lanes (`NiceRegionError::try_report_placeholder_conflict`, errrep-nice-region; `<RegionOriginNote as
  Subdiagnostic>::add_to_diag`, errrep-infer-b). Today all six stop there. **Verified in the resumed session**: with
  temporary, uncommitted stand-ins (the other-lane `try_report_*` returning `None`, a `RegionOriginNote::add_to_diag`
  covering `Plain` / `WithName`), all six cases were byte-identical to the oracle (stderr and exit code). The stand-ins
  were reverted.

## Samples (lane vs base; base = integ `52b5e37d` runs by other wave-19 lanes, `errrep-infer-a-base`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-081135-errrep-region-e6k1` | 21 / 0 / 25 / 0 | `20261021-081230-errrep-infer-a-base-ntgd` | 21 / 0 / 25 / 0 |
| thirdump-minicore (46) | `20261021-081204-errrep-region-7f8g` | 21 / 0 / 25 / 0 | `20261021-081307-errrep-infer-a-base-slgb` | 21 / 0 / 25 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-081230-errrep-region-uwfr` | 289 / 0 / 11 / 0 | `20261021-081352-errrep-infer-a-base-7q7v` | 289 / 0 / 11 / 0 |

Per-case statuses and UNPORTED stop texts are identical to the base (no case in these samples reaches region error
reporting). No new DIFF. The samples ran before `9cdee8e6`, which only changes `trim_start` in
`suggest_precise_capturing`'s APIT branch; no sample case reaches it.

## `unported(...)` left
- None in this lane's code.
- Reached through it (other lanes' placeholders): `NiceRegionError::try_report_placeholder_conflict` /
  `try_report_placeholder_relation` / `try_report_impl_not_conforming_to_trait` / `try_report_static_impl_trait` /
  `try_report_mismatched_static_lifetime` (errrep-nice-region), `Highlighted_into_diag_arg` (errrep-nice-region, used by
  `unexpected_hidden_region_diagnostic`), `RegionOriginNote_add_to_diag` and the other diagnostics.ts manual impls
  (errrep-infer-b), `report_and_explain_type_error` / `values_str` / `report_extra_impl_obligation` /
  `deeply_resolve_ignoring_regions` / `ty_to_string` (errrep-infer-a and other owners). **Every region error stops at
  `try_report_placeholder_conflict` until errrep-nice-region lands** (it is the second `try_report_from_nll` step).

## `// PORT:` decisions
1. Other rustc_trait_selection modules (diagnostics.ts, diagnostics/note_and_explain.ts, find_anon_type.ts,
   placeholder_error.ts) are read through lazy `require` inside function bodies (contract rule 6, init order).
2. region.ts `fold_GenericKind`: `GenericKind`'s generated TypeFoldable/TypeVisitable fns wrapped as a `TypeFoldable`
   descriptor (for `(bound_kind, sub).has_infer_regions()` / `is_suggestable`).
3. `error.clone()` (report_region_errors, try_report_nice_region_error): not cloned; payloads are never mutated.
4. `process_errors`: `sort_by_key(lo_hi)` → stable `Array.prototype.sort` comparing `(lo, hi)`.
5. `construct_generic_bound_failure`'s final 20-pattern `let`-chain (region.rs:892..918, after `sub.kind() ==
   ReStatic`) is the module-local helper `boxed_dyn_trait_with_implicit_static` returning the bound `ty` (same pattern
   order, same checks).
6. `LifetimeReplaceVisitor` is a module-level class (local struct upstream); its `lt.kind == self.needle` is the derived
   `PartialEq` of `hir::LifetimeKind` (tag, plus the `LocalDefId` for `Param`).
7. `unexpected_hidden_region_diagnostic`: `format!("{hidden_ty}")` is `Highlighted`'s `Display`; until
   errrep-nice-region ports it, the string is read from `Highlighted_into_diag_arg` (upstream `DiagArgValue::Str(
   self.to_string())`), evaluated only in the arms that format it.
8. `suggest_precise_capturing`: `trim_start()` is a local helper over std `char.ts` `is_whitespace` (not JS
   `trimStart`, which strips U+FEFF and misses U+0085); `trim_start_matches("impl")` is a loop.
9. `DiagStyledString == DiagStyledString` (report_sub_sup_conflict) is a local `DiagStyledString_eq` (derived
   `PartialEq` of `DiagStyledString` / `StringPart`: content + style).
10. nice_region_error/mod.ts: field `regions` is `regions_` (contract decision 3); `new_from_span` is assigned through
    a local `NiceRegionError_statics` view, marked `// PORT(decls): pending root` (see below).

## For root
1. **decls.ts (pending root)**: `namespace NiceRegionError` in `src/rustc_trait_selection/decls.ts` has `export { new_ as
   new }`, so its other associated fns (`new_from_span`, `get_impl_ident_and_self_ty_from_trait`) are not exported.
   mod.ts assigns `new_from_span` through a local `NiceRegionError_statics` interface. Exporting them from the
   namespace would remove that view (errrep-nice-region assigns `get_impl_ident_and_self_ty_from_trait` and may hit the
   same thing).
2. The oracle test's PENDING set names two placeholders owned by other lanes. Once errrep-nice-region and errrep-infer-b
   are merged, remove the matching entries so the six cases must equal the oracle (they did with stand-ins, above).
3. Record PORT decisions 5 (let-chain helper) and 7 (Highlighted Display via IntoDiagArg until errrep-nice-region lands;
   switch to its `Display` then).
