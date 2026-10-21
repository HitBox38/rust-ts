# Handoff: errrep-traits-a (M3 wave 19, error reporting)

Branch `lane/errrep-traits-a` (from integ `52b5e37d`, no merges). Resumed after an API-limit cut-off: the previous
agent's uncommitted ports were reviewed against upstream (one fix: `goal_eq` compared `ParamEnv` objects by identity,
now `ParamEnv_eq`) and committed.

Commits: `bf2266d4` mod.rs (rest) + on_unimplemented.rs → `5c7136d1` fulfillment_errors.rs:1..1529 → `dc4d025c` test
re-pins → this handoff.

## Files touched
- `src/rustc_trait_selection/error_reporting/traits/mod.ts`: `report_fulfillment_errors`, `report_fulfillment_error`,
  `extern_crates_with_the_same_name`, `check_same_definition_different_crate`, `to_pretty_impl_header`,
  `report_extra_impl_obligation`, `report_dyn_incompatibility`, `attempt_dyn_to_enum_suggestion`,
  `attempt_dyn_to_impl_suggestion` (stubs and the `unported_methods` list removed).
- `src/rustc_trait_selection/error_reporting/traits/on_unimplemented.ts`: `describe_enclosure`, `on_unimplemented_note`,
  `on_unimplemented_components`.
- `src/rustc_trait_selection/error_reporting/traits/fulfillment_errors.ts` (my region only, upstream order):
  `report_selection_error`, `apply_do_not_recommend`, `report_host_effect_error`, `emit_specialized_closure_kind_error`,
  `fn_arg_obligation`, `detect_negative_literal`, `try_conversion_context` (+ nested `FindMethodSubexprOfTry::visit_expr`),
  `note_missing_impl_for_question_mark`, `report_const_param_not_wf`. Lane errrep-traits-b's `unported_methods` lists
  (bottom of the file) are untouched.
- Outside the assignment (re-pins, please review): `src/rustc_infer/contract.test.ts`,
  `src/rustc_hir_analysis/check/wfcheck_a.test.ts`, `src/rustc_hir_analysis/check/wfcheck_b.test.ts` (see below).

## Coverage
- error_reporting/traits/mod.rs 15/15, on_unimplemented.rs 3/3, fulfillment_errors.rs 10/54 (all 10 fns of :1..1529;
  the 44 missing are lane errrep-traits-b's :1531..).
- rustc_trait_selection 619/976 (was 597); TOTAL 15926/25518.
- `bun scripts/coverage.ts --check`: markers ok (16445; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_trait_selection`: 66 pass, 0 fail (incl. `errctxt_contract.test.ts`).
- `bun test src/rustc_infer src/rustc_hir_analysis src/rustc_hir_typeck`: 469 pass after the re-pins (3 failed before).

## Samples (lane vs base at `52b5e37d`; base runs by sibling lanes on the same base)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-083149-errrep-traits-a-gqku` | 21 / 0 / 25 | `20261021-082718-errrep-infer-b-base-c2en` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-083155-errrep-traits-a-gqhd` | 21 / 0 / 25 | `20261021-082727-errrep-infer-b-base-0472` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-083201-errrep-traits-a-455s` | 289 / 0 / 11 | `20261021-082746-errrep-infer-b-base-u38h` | 289 / 0 / 11 |

No new DIFF. Per-case diff vs base: only `tests/ui/traits/default_auto_traits/maybe-bounds-in-traits.rs` changed stop
(`report_fulfillment_errors` → lane b's `fulfillment_errors::TypeErrCtxt::error_implies`), in both minicore suites;
tydump-nocore identical.

Stop chain after this lane: every trait error now stops first at `error_implies` (lane errrep-traits-b; it is called
for every reported error, since each error is compared with itself). With a local, uncommitted stand-in for
`error_implies` / `trait_error_implies_projection_error` (exact only for the equal / non-projection paths), the
maybe-bounds case and wfcheck_b static_wf.rs reach `get_parent_trait_ref` (lane b) inside `report_selection_error`;
wfcheck_a field_bound.rs reaches a non-error-reporting gap: `rustc_middle::query::keys: QueryKey for
(ty::Predicate<'tcx>, WellFormedLoc) (cache)` (`diagnostic_hir_wf_check`).

## `unported(...)` left
- None in the ported bodies. Calls to other lanes' placeholders remain (lane b: `error_implies`,
  `trait_error_implies_projection_error`, `get_parent_trait_ref`, `get_standard_error_message`, `report_projection_error`,
  ...; suggestions lanes; ambiguity / need_type_info; `note_type_err` (errrep-infer-a)).

## `// PORT:` decisions
- mod.rs: `report_fulfillment_errors` sorts a copy of `errors` (owned `ThinVec` upstream); `ErrorSortKey` (derived `Ord`)
  is a `[variant index, ..fields]` array compared lexicographically, stable sort; `Option<usize> >= Option<usize>` with
  `None < Some`. `check_same_definition_different_crate`: `UnordSet<(String, DefId)>` is a `KeyedSet` on `intern_key`,
  sorted by the path (`str_cmp`, byte order). `report_dyn_incompatibility`: `FxIndexSet<DynCompatibilityViolation>` is a
  `KeyedSet` on `intern_key`; `potential_solutions.sort()/dedup()` uses a hand `cmp_DynCompatibilityViolationSolution`
  (derived `Ord`: variant order, then fields; `Symbol` by index, `OrdSpan::cmp`). `attempt_dyn_to_enum_suggestion`:
  `collect::<Option<Vec<_>>>()` stops at the first `None`.
- on_unimplemented.rs: `find_attr!(.., OnUnimplemented { directive, .. } => directive.as_deref()).flatten()` is
  `find_attr(HasAttrs_DefId.get_attrs(..), ..)` wrapping the directive so the first matching attribute wins even when its
  directive is `None` (same for `OnConst` in `report_host_effect_error`); `FormatArgs { .., .. }` spells the default
  fields (`""`).
- fulfillment_errors.rs: `mut obligation` (owned) is a `clone_Obligation` copy; `main_trait_predicate ==
  leaf_trait_predicate` and `code == *root_obligation.cause.code()` (derived `PartialEq`) use `intern_key`;
  `Goal<Predicate>` equality is `ParamEnv_eq` + predicate identity; `&mut Option<PathBuf>` locals are `MutRef` cells and
  `*diag.long_ty_path() = file` assigns `.value`; `SelectionContext` (traits/select/mod.ts) and traits/mod.gen.ts are read
  through lazy `require` (init order).

## For root
1. Review the three test re-pins (no assertion weakened; each pins the exact new stop): wfcheck_a field_bound.rs and
   wfcheck_b static_wf.rs `report_fulfillment_errors` → `fulfillment_errors::TypeErrCtxt::error_implies`;
   rustc_infer contract.test.ts "the contract's placeholders stop as UNPORTED" now calls lane b's `describe_closure`
   placeholder (`report_fulfillment_errors([])` is ported; with no errors it reaches `delayed_bug`, which the mock tcx
   cannot run). Lane errrep-traits-b will have to re-pin these again when it ports `error_implies` / `describe_closure`.
2. `src/rustc_trait_selection/traits/wf_dyn.test.ts`: dyn_e0038.rs now prints the oracle's E0038 byte for byte
   (`report_dyn_incompatibility` ported); its `PENDING_E0038` entry is stale (harmless; the test takes the full-compare
   path). Can be removed by its owner.
3. Merge order with errrep-traits-b: both lanes edit fulfillment_errors.ts in disjoint regions (mine above the
   `// ==== lane errrep-traits-b` marker, its list below); the import block of lane a is a separate section.
