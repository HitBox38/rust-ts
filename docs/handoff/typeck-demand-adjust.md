# Handoff: typeck-demand-adjust (M3, wave 19, error reporting)

Branch `lane/typeck-demand-adjust`, based on integ 52b5e37d. Row 2 of the split table in `docs/handoff/errctxt-contract.md`.
No baselines, oracle outputs, suites, `harness/`, `scripts/`, `tools/`, `decls.ts` or `UPSTREAM.json` touched. Resumed
once (the first agent hit a usage limit after the two port commits; the resumed agent reviewed them and added the tests).

## Files touched
- `src/rustc_hir_typeck/fn_ctxt/adjust_fulfillment_errors.ts`: the whole upstream file (20/20 fns), replacing the
  placeholders.
- `src/rustc_hir_typeck/demand.ts`: everything except :171..289 (`demand_*`, lane typeck-coerce, unchanged).
  `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/demand.rs` gives 25/25 (that count includes the
  typeck-coerce fns).
- New test `src/rustc_hir_typeck/demand_adjust.test.ts` + `demand_adjust_test/` (3 `#![no_core]` cases, oracle
  projections `<case>.expected.json`, `REGEN=1` rewrites them, runner `run.ts`).

## Coverage
- `fn_ctxt/adjust_fulfillment_errors.rs` 20/20, `demand.rs` 25/25. `bun scripts/coverage.ts --check`: markers ok.
- `bunx tsc --noEmit -p .` clean. `bun test src/rustc_hir_typeck`: 125 pass / 0 fail (14 files);
  `src/rustc_trait_selection/errctxt_contract.test.ts` green.

## Tests (demand_adjust.test.ts)
The other wave-19 lanes' reporting methods are placeholders, so `run.ts` replaces them with test stand-ins in its own
process only (`PORT (test)`):
- mode `adjust`: `TypeErrCtxt::report_fulfillment_errors` emits one stand-in error per fulfillment error at the cause span
  after `adjust_fulfillment_errors_for_expr_obligation`. Compared with the primary spans of the oracle's E0277s
  (`adjust_args` 8 errors: argument blaming and the `ImplDerived` drilling through tuples / refs / struct literals /
  ctors / variants / nesting; `adjust_paths` 11 errors: turbofish on calls / paths / methods, elided lifetimes,
  struct-expression fields, method receivers, type-relative paths).
  Finding: rustc's own final span differs from the cause span in one case. When the receiver of a method call is blamed
  (`b.me()` with `where Self: Tr`), `adjust_fulfillment_errors.rs` correctly points at `b`, and then
  `note_function_argument_obligation` (rustc_trait_selection error_reporting/traits/suggestions.rs:5459) moves the primary
  span to the method name. The runner does that move itself so the fixtures can stay unedited oracle output. The lane
  that ports suggestions.rs must do the same move, or the `self_param` case fails once the stand-in is gone.
- mode `demand`: `report_mismatched_types` returns a bare `error: mismatched types` (no code: the JSON emitter needs the
  unported long E0308 description), and the fn_ctxt/suggestions.rs predicates `emit_*_suggestions` calls answer "no
  suggestion". Compared with the oracle's JSON minus what `note_type_err` adds (primary label, `found this type
  parameter`, the span-less expected/found note; primary spans listed first). `demand_basic` (9 errors):
  `annotate_expected_due_to_let_ty` (let / param / local / field), the `note_source_of_type_mismatch_constraint` chain,
  `annotate_loop_expected_due_to_inference`, `annotate_mut_binding_to_immutable_binding` (multipart suggestion),
  `explain_self_literal` (label + verbose suggestion). All equal.

## Sample difftests (`RUST_TS_AGENT=typeck-demand-adjust`; MATCH / DIFF / UNPORTED, no CRASH / TIMEOUT)
| suite | base 52b5e37d | after | run (after) |
|---|---|---|---|
| tydump-minicore (46) | 21 / 0 / 25 (`…-base-zgj0`) | 21 / 0 / 25 | 20261021-typeck-demand-adjust-tmc |
| thirdump-minicore (46) | 21 / 0 / 25 (`…-base-wdfq`) | 21 / 0 / 25 | 20261021-typeck-demand-adjust-thmc |
| tydump-nocore `--sample 300 --seed m17` | 289 / 0 / 11 (20261021-tda-base-tnc) | 289 / 0 / 11 (identical per case) | 20261021-typeck-demand-adjust-tnc |

The minicore cases have 4 changed stops, the same in both suites. The 3 cases that stopped at
`adjust_fulfillment_error_for_expr_obligation` (`default_auto_traits/default-bounds.rs`, `extern-types.rs#current`,
`#next`), plus `maybe-bounds-in-dyn-traits.rs`, now stop at `TypeErrCtxt::report_fulfillment_errors` (lane
errrep-traits-a). No new DIFF.

## `unported(...)` left
None in either file. Calls into other lanes' placeholders remain (`TypeErrCtxt` methods, fn_ctxt/suggestions.rs and
method/suggest.rs fns reached from `emit_type_mismatch_suggestions` / `emit_coerce_suggestions`).

## `// PORT:` decisions
- demand.ts: `&mut &'tcx hir::Expr` / `&mut Option<&hir::Expr>` parameters are `MutRef` cells (PORTING §8), and a
  `var: &mut &Expr` assignment is a setter writing back into its cell. The local visitors `FindExprs` / `FindBreaks` are
  module-level classes, and the local enum `CallableKind` is a string union. `self.typeck_results.borrow()` is
  `this.typeck_results`. Where upstream shadows a name, the port says so in a comment (`parent_id` and `parent` in
  annotate_loop_expected_due_to_inference).
- adjust_fulfillment_errors.ts: `&mut FulfillmentError` is edited in place (`cause.span = ..`, `cause.map_code(..)`).
  `ParamTerm::index` is a companion fn. `FindAmbiguousParameter` is a module-level class.
- Test only: the stand-ins in `demand_adjust_test/run.ts`, as described above.

## Items for root
- Lane errrep-traits-a / the suggestions.rs owner: keep the receiver-to-method-name span move at suggestions.rs:5459.
  `demand_adjust.test.ts` documents it.
- When errrep-infer-a (`report_mismatched_types` / `note_type_err`) and typeck-fnsugg-a/-b merge, the `demand` stand-ins
  in run.ts can go. The test can then compare the full human stderr (as loops.test.ts does), and `NO_SUGGESTION_*` can be
  removed.
