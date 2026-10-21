# Handoff: errrep-sugg-b (M3 wave 19, error reporting): suggestions.rs:2485..5017

Branch `lane/errrep-sugg-b`, based on integ `52b5e37d`, no merges. Row 8 of the split table in
`docs/handoff/errctxt-contract.md`. No baselines, oracle outputs, suites, `harness/`, `scripts/`, `tools/`, decls.ts or
`UPSTREAM.json` touched. The lane was resumed after the first agent hit an API limit; that agent's port commit was kept
and reviewed.

## Commits
1. `798e38d5` port of suggestions.rs:2485..5017 (first agent).
2. `9985acac` oracle test `suggestions_b.test.ts` + `suggestions_b_test/` (6 crates + run.ts).
3. This handoff.

## Files touched
- `src/rustc_trait_selection/error_reporting/traits/suggestions.ts`: only the `// ==== lane errrep-sugg-b ====` section
  (TS 270..2843) and new imports at the top. The lane's `unported_methods` list is gone (it is empty).
- New: `src/rustc_trait_selection/error_reporting/traits/suggestions_b.test.ts` and `suggestions_b_test/`.

## Coverage
- suggestions.rs: 22/80. Every fn in 2485..5017 is ported (18 fns, including the nested `build_fn_sig_ty`). The 58
  still missing are all outside the region: 21 belong to sugg-a and 37 to sugg-c.
- rustc_trait_selection 615/976 (was 597). TOTAL 15922/25518. `coverage.ts --check`: markers ok (16441; vendor 3888).

## Fns ported (upstream order)
`suggest_change_mut`, `suggest_semicolon_removal`, `removable_trailing_semicolon`, `emit_semicolon_removal_suggestion`,
`suggest_semicolon_removal_in_closure_arg`, `suggest_borrow_for_unsized_closure_return`, `return_type_span`,
`suggest_impl_trait`, `report_closure_arg_mismatch` (+ nested `build_fn_sig_ty`), `note_conflicting_fn_args`,
`note_conflicting_closure_bounds`, `suggest_fully_qualified_path`, `maybe_note_obligation_cause_for_async_await`,
`note_obligation_cause_for_async_await`, `note_closure_capture`, `note_obligation_cause_code`,
`note_obligation_cause_code_inner` (all 64 `ObligationCauseCode` arms).

Review: an independent read-only pass compared TS 270..2650 with upstream 2485..5017 and found no fidelity bugs. It
checked the arm set, branch order, message strings, Applicabilities, `while let` / labeled-break semantics and slicing.

## `unported(...)` left (in this lane's code)
- `CoroutineData::get_from_await_ty` / `CoroutineData::try_get_upvar_span` (suggestions.rs:95 / :73, lane errrep-sugg-a).
  They are reached through the bridges `CoroutineData_get_from_await_ty` / `CoroutineData_try_get_upvar_span`. Each bridge
  calls the method from `CoroutineData.prototype` if sugg-a installed it, and is `unported` otherwise. **Root at merge:**
  once sugg-a lands, replace the bridges with direct calls in whatever form sugg-a chose.

Other lanes' placeholders this code reaches:
- sugg-c: `is_truly_imperfect_derive`, `note_function_argument_obligation`, `point_at_chain_in_return_position`, and the
  free fns `point_at_assoc_type_restriction`, `hint_missing_borrow`, `get_deref_type_and_refs`.
- fulfillment_errors (traits-a/-b): `is_recursive_obligation`, `mk_trait_obligation_with_new_self_ty`.
- infer/mod.rs (infer-a): `cmp`.

## `// PORT:` decisions
- The query values `typeck`, `coroutine_kind`, `generics_of`, `type_of` and `mir_coroutine_witnesses` are typed `unknown`
  in queries.gen.ts, so they are cast at the use site to their upstream types. `mir_coroutine_witnesses` is read through
  the local `CoroutineLayoutView`, which has only the fields this code reads (until MIR lands in M4; precedent
  rustc_traits `CoroutineLayoutFieldTys`).
- `#[derive(TypeFoldable, TypeVisitable)]` of `TraitClausePrintModifiersAndPath` / `TraitRefPrintOnlyTraitPath`
  (pretty.rs) is hand-written locally because codegen has no folds for the print wrappers (precedent
  hir_ty_lowering/errors.ts). **Root:** it could become generated.
- `parent_predicate` in `ImplDerived` keeps its inferred type `PolyTraitClause`, and its `.upcast(tcx)` calls pass the
  explicit `upcast_from_PolyTraitClause`.
- `suggest_semicolon_removal_in_closure_arg`: the lazy `filter_map` plus two `next()` calls are a generator, so at most the
  first two candidates are read.
- Module-level helpers in the lane section: `set_insert`, `chars`, `trim_start_matches`, `slice_eq`, `is_some_and`,
  `Binder_eq`, `fn_sig_of_node`, `print_*` / `display_*` / `upcast_from_*` / `d_*` adapters, `traits_er_mod()` (a lazy
  require of ./mod.ts for init order). **Root at merge:** sugg-a or sugg-c may define the same top-level names in this
  file. Rename or deduplicate any clash.

## Test (`suggestions_b.test.ts`, 6 tests, pass)
`suggestions_b_test/run.ts` runs the driver through the tydump analysis prefix. It swaps `report_fulfillment_errors` for a
TEST stand-in, which emits E0277 with a placeholder message plus exactly what `note_obligation_cause` adds first
(`maybe_note_obligation_cause_for_async_await`, otherwise `note_obligation_cause_code`). For each error, the human-format
sub-diagnostics we print must appear verbatim and contiguously in the oracle's error. JSON format cannot be used because
the E0277 long description is unported.
- Exact: `implicit_sized.rs`, `field_sized.rs` (2 errors), `assoc_sized.rs`, `trivial_bound.rs`.
  - Arms covered: WhereClause with the implicit-`Sized` label, FieldSized struct/enum with the `&` / `Box` suggestions,
    the associated-type `?Sized` suggestion, and TrivialBound.
- Pinned stops: `auto_trait.rs` → `fulfillment_errors::TypeErrCtxt::is_recursive_obligation`; `where_clause.rs` →
  `suggestions::point_at_assoc_type_restriction` (sugg-c).
  - When those lanes land, move these cases to the exact list.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_trait_selection --timeout=120000`: 72 pass, 0 fail. This includes
  `errctxt_contract.test.ts` and the new test.

## Samples (`RUST_TS_AGENT=errrep-sugg-b`; base = integ 52b5e37d runs by errrep-sugg-c-base)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-081956-errrep-sugg-b-7mds` | 21 / 0 / 25 / 0 | `20261021-081115-errrep-sugg-c-base-g5f0` | 21 / 0 / 25 / 0 |
| thirdump-minicore (46) | `20261021-082034-errrep-sugg-b-a19x` | 21 / 0 / 25 / 0 | `20261021-081140-errrep-sugg-c-base-xbv6` | 21 / 0 / 25 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-082110-errrep-sugg-b-2u4n` | 289 / 0 / 11 / 0 | `20261021-081208-errrep-sugg-c-base-ewgg` | 289 / 0 / 11 / 0 |

The minicore stop distribution is the same as base, as expected: this code runs only under `report_fulfillment_errors`
(lane errrep-traits-a), which no case gets past yet.
