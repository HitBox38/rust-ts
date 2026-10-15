# Handoff: typeck-pat-a (M3 wave 18b, rustc_hir_typeck)

Branch `lane/typeck-pat-a` (from integ `a5910d3`, no merges).

## Result
- **pat.rs:1..1779 fully ported** (37 fns incl. the free fn `is_number` and the helper impls): `pattern_cause`,
  `demand_eqtype_pat_diag`, `demand_eqtype_pat`, `AdjustMode::{peel_until_adt, peel_all}`,
  `MutblCap::{cap_to_weakly_not, as_mutbl}`, `ResolvedPat::adjust_mode`, `downgrade_mut_inside_shared`,
  `ref_pat_matches_inherited_ref`, `ref_pat_matches_mut_ref`, `check_pat_top`, `check_pat`, `check_pat_inner`,
  `adjust_pat_info`, `check_deref_pattern`, `calc_adjust_mode`, `should_peel_ref`, `should_peel_smart_pointer`,
  `check_pat_expr_unadjusted`, `check_pat_lit`, `check_pat_range`, `endpoint_has_type`, `emit_err_pat_range`,
  `check_pat_ident`, `check_binding_alt_eq_ty`, `suggest_adding_missing_ref_or_removing_ref`, `borrow_pat_suggestion`,
  `check_dereferenceable`, `resolve_pat_struct`, `check_pin_projection`, `check_pat_struct`, `resolve_pat_path`,
  `check_pat_path`, `maybe_suggest_range_literal`, `emit_bad_pat_path`.
- **lib.rs:479 `report_unexpected_variant_res`** ported (lib.rs now 17/17).

## Files touched
- `src/rustc_hir_typeck/pat.ts`: the pat-a region (between the `==== lane typeck-pat-a` and `==== lane typeck-pat-b`
  headers; the pat-a `unported_methods` list is gone), `is_number` filled in place at the end, imports at the top,
  first header line updated. The pat-b list/header are untouched. **Merge note:** pat-b edits the same file; expect a
  conflict only in the import block at the top (union both sides).
- `src/rustc_hir_typeck/lib.ts`: `report_unexpected_variant_res` replaces its placeholder; imports (`E0164`, `Res as
  ResC`, `qpath_to_string`, `HirId_eq`, `Span` now a value import, `display_Ident`/`Symbol`, `FnCtxt_as_PpAnn`); the
  now-unused `unported_methods` import removed.
- `src/rustc_hir_typeck/pat_a.test.ts` (new, 6 tests): `is_number`, `AdjustMode`/`MutblCap` helpers,
  `ResolvedPat::adjust_mode`, `adjust_pat_info` binding-mode arithmetic, `should_peel_ref` early return.
- No change to decls.ts, generated files, tools, harness, scripts.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/pat.rs`: 37/70 ported; every missing fn is at
  line >= 1781 (lane typeck-pat-b).
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/lib.rs`: 17/17.
- `bun scripts/coverage.ts --check`: `markers ok (15201; vendor 3888)`.

## `unported(...)` left
None in the ported region. Calls that still reach other lanes' placeholders (expected until merge):
- typeck-impl (fn_ctxt/_impl.rs): `write_ty`, `local_ty`, `node_ty`, `structurally_resolve_type`,
  `deeply_resolve_ignoring_regions_with_obligations`, `resolve_ty_and_res_fully_qualified_call`,
  `instantiate_value_path`, `register_bound`.
- typeck-coerce (demand.rs:171..289): `demand_eqtype_with_origin`, `demand_suptype_with_origin`.
- typeck-checks-a: `check_expr_lit`, `check_struct_path`. typeck-expr-a: `check_expr_has_type_or_error` (guard patterns).
- typeck-pat-b: `resolve_pat_tuple_struct`, `check_pat_tuple_struct`, `check_pat_tuple`, `check_struct_pat_fields`,
  `check_pat_deref`, `deref_pat_target`, `register_deref_mut_bounds_if_needed`, `check_pat_ref`, `new_ref_ty`,
  `check_pat_slice`, `add_rust_2024_migration_desugared_pat`.
- **Error path, wave 19:** `suggest_fn_call` (fn_ctxt/suggestions.rs), reached only from `demand_eqtype_pat_diag` when
  the eq-type fails and the pattern has an origin expression (a `match`/`let` scrutinee). No other success-path call
  leaves the crate's ported/assigned code.

## PORT decisions
1. `TopInfo` / `PatInfo` (`Copy`) are shared, never-mutated objects; `PatInfo { .., ..old }` updates build new objects
   (`{ ...old, current_depth: .. }`).
2. `impl AdjustMode` / `impl MutblCap` are on the companions exported by pat.ts (`AdjustMode = { ...gen.AdjustMode,
   peel_until_adt, peel_all }`, `MutblCap = { ...gen.MutblCap, cap_to_weakly_not, as_mutbl }`, PORTING §8); `impl
   ResolvedPat` is `gen.ResolvedPat.prototype.adjust_mode` (module augmentation of pat.gen.ts).
3. `#[cfg(debug_assertions)]` (`check_pat_inner`) and `cfg!(debug_assertions)` (`calc_adjust_mode`) code stays as
   comments (rustc ships without debug assertions), like `debug_assert!`.
4. `check_pat_range`: the `(fail, ty, span)` sides are mutable 3-arrays (`RangeSide`); `calc_side` returns fresh arrays,
   the `demand_eqtype` closure sets `x[0] = true` (`ref mut fail`) and reads only `y`'s type/span.
   `(lhs, rhs).references_error()` uses a local descriptor `visit_RangeSides` (visit.rs's tuple/Option impls over
   bool's and Span's trivial traversals).
5. `check_pat`'s `filter_map` iterator to `register_deref_mut_bounds_if_needed` is a lazy generator.
6. `report_unexpected_variant_res`: upstream shadows `span` inside the `expr.is_none()` arm; the port names it `span_`
   and the suggestion span reads `span_` as upstream reads the shadowed one.
7. Char arguments of `add_rust_2024_migration_desugared_pat` are code points (`0x74` 't', `0x66` 'f').

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=60000`: 18 pass / 0 fail (contract.test.ts 12, pat_a.test.ts 6). The
  contract test's placeholder probe for `report_unexpected_variant_res` is conditional on the method still being a
  stub, so it passes unchanged.
- No pre-existing unit test's pinned stop moved.

## Samples
Lane = this branch (`RUST_TS_AGENT=typeck-pat-a`), base = `a5910d3` checked out in this worktree
(`RUST_TS_AGENT=typeck-pat-a-base`), same `--seed`. Per-case status and stop identical (0 differing cases).

| suite | run | MATCH | DIFF | UNPORTED | CRASH | base |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-080836-typeck-pat-a-7m1m` | 5 | 0 | 41 | 0 | `20261015-081134-typeck-pat-a-base-xyzp`: 5/0/41/0 |
| tydump-nocore `--sample 100 --seed typeck-pat-a` | `20261015-080856-typeck-pat-a-pryi` | 78 | 0 | 22 | 0 | `20261015-081105-typeck-pat-a-base-x19a`: 78/0/22/0 |
| hir-tree-nocore `--sample 100 --seed typeck-pat-a` | `20261015-080934-typeck-pat-a-qhz1` | 100 | 0 | 0 | 0 | (no typeck involved) |

Top stops (none reaches pattern checking yet): tydump-minicore `rustc_trait_selection::traits::fulfill::FulfillmentContext::new`
(old solver, 34), `check_unused_traits provider` (3), StableHash without a TS impl (2); tydump-nocore
`LateParamRegionKind::from_bound` (7), `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)` (4), `QueryKey for
LitToConstInput` (4). Pattern code is exercised only once typeck-lib-wb (`loops::check`, `check_fn`) and typeck-impl land.

## For root
- Record PORT decisions 1–7 above if desired (2 and 4 are representation choices).
- Merge with typeck-pat-b: union the import blocks of pat.ts.
