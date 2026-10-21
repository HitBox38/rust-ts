# Handoff: errrep-need-type-info (M3 wave 19, error reporting)

Branch `lane/errrep-need-type-info` (from integ `52b5e37d`, no merges). Resumed after the first agent was cut off before
committing; its uncommitted work was reviewed against upstream (both files, function by function) and committed.

## Files touched
- `src/rustc_trait_selection/error_reporting/infer/need_type_info.ts` (upstream need_type_info.rs, 1534 lines)
- `src/rustc_trait_selection/error_reporting/traits/ambiguity.ts` (upstream traits/ambiguity.rs, 933 lines)

No other file edited. `errctxt_contract.test.ts` green; the stubs' `unported_methods` / `Fns_` placeholders of both files
are gone (methods on `TypeErrCtxt.prototype`, free fns as `export function`).

## Coverage
- need_type_info.rs 39/39, traits/ambiguity.rs 6/6 (`bun scripts/coverage.ts --missing ...`).
- rustc_trait_selection 642/976 (was 597); TOTAL 15949/25518. `coverage.ts --check`: markers ok (16468; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_trait_selection`: 66 pass, 0 fail (11 files). No other test names need_type_info / ambiguity items.

## Samples (lane vs base `52b5e37d`; base = detached worktree, `RUST_TS_AGENT=errrep-need-type-info-base`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-082419-errrep-need-type-info-figx` | 21 / 0 / 25 / 0 | `20261021-082022-errrep-need-type-info-base-lp5r` | 21 / 0 / 25 / 0 |
| thirdump-minicore (46) | `20261021-082432-errrep-need-type-info-a2sp` | 21 / 0 / 25 / 0 | `20261021-082104-errrep-need-type-info-base-iw0f` | 21 / 0 / 25 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-082443-errrep-need-type-info-qq6p` | 289 / 0 / 11 / 0 | `20261021-082133-errrep-need-type-info-base-ax5m` | 289 / 0 / 11 / 0 |

No new DIFF; per-case statuses and UNPORTED stops identical to base (no sampled case reaches E0282/E0283/E0284 or
ambiguity reporting yet; minicore stops are upstream of it: `note_type_err`, `adjust_fulfillment_error_for_expr_obligation`, ...).

## `unported(...)` left
- ambiguity.ts `fold_TraitClausePrintModifiersAndPath_` (visit_with / try_fold_with / fold_with): the
  `#[derive(TypeFoldable, TypeVisitable)]` of rustc_middle pretty.rs:3056 `TraitClausePrintModifiersAndPath` has no
  generated descriptor (same precedent as hir_ty_lowering/errors.ts `fold_TraitRefPrintOnlyTraitPath_`). It is reached by
  printing `Binder<TraitClausePrintModifiersAndPath>` (`prepare_region_info` visits the value at binder depth 0), i.e. the
  E0283 notes "the type must implement `{tr}`" / "must also implement" in `maybe_report_ambiguity`. Expect it to be the
  next stop of E0283 cases whose self type is an inference variable.

## `// PORT:` decisions
- need_type_info.rs is hand-typed (not in the codegen set: syn cannot parse `do yeet ()`); `try { .. }` blocks are IIFEs.
- `UnderspecifiedArgKind::Type { prefix: Cow<str> }` → `string`; `usize::MAX` (`infer_source_cost`) →
  `Number.MAX_SAFE_INTEGER`.
- Lazy iterators (`Box<dyn Iterator>`, `filter_map(..).chain(..)`, `comma_sep(iter.map(..))`) are generators so the queries /
  inference variables their closures make happen in upstream's order; `last_segment_using_path_data` stays eager.
- `let`-chains used as match guards are small local helpers (`generic_arg_names_err_path`, `collect_into_try_return` +
  `collect_try_return_adt` in need_type_info.ts; `match_assoc_item_call` in ambiguity.ts).
- fn-local `struct CostCtxt` of `source_cost` is a module-level class (markers on its methods).
- `PORT(merge)`: `Highlighted_to_string` in need_type_info.ts is the body of placeholder_error.rs:50
  `impl Display for Highlighted` (lane errrep-nice-region), kept unmarked so the E0282 path runs before that lane merges.

## For root
1. After errrep-nice-region merges, replace need_type_info.ts's `Highlighted_to_string` by that lane's export.
2. Codegen: `TypeFoldable` / `TypeVisitable` for pretty.rs:3056 `TraitClausePrintModifiersAndPath` (and `TraitRefPrintOnlyTraitPath`
   for hir_ty_lowering/errors.ts) — delegates to `TraitClause` on `_0`; unblocks the E0283 notes above.
3. rustc_mir_build `thir/pattern/const_to_pat.ts` still has a local `compute_applicable_impls_for_diagnostics` stand-in
   (and a local `CandidateSource`): repoint it to ambiguity.ts's export (3rd param is upstream's
   `ignore_predicates_of_impls`; ambiguity.gen.ts's `CandidateSource`).
