# Handoff: typeck-checks-b (M3 wave 19, rustc_hir_typeck argument-error reporting)

Branch `lane/typeck-checks-b` (from integ `52b5e37d`, no merges). Commits: `ea234c20` (port), `cdf13301` (oracle tests),
plus this handoff. The first agent was cut off by an API limit after the two commits; a resumed agent reviewed the port,
ran the checks and wrote this file (no code change after `cdf13301`).

## Result
Every fn of `compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1669..3710` is ported (row 13 of the split table in
`docs/handoff/errctxt-contract.md`): `label_fn_like`, `FnCtxt::label_generic_mismatches`, `get_hir_param_info`,
`FindClosureArg` (`maybe_tcx`, `visit_expr`), `FnParam` (`span`, `display` + `fmt`), `FnCallDiagCtxt` (`deref`, `new`,
`check_wrap_args_in_tuple`, `ensure_has_errors`, `detect_dotdot`, `filter_out_invalid_arguments`,
`check_single_incompatible`, `maybe_optimize_extra_arg_suggestion`, `initial_final_diagnostic`,
`labels_and_suggestion_text` + nested `has_error_or_infer`, `label_generic_mismatches`, `append_arguments_changes`,
`format_suggestion_text`, `arguments_formatting`, `suggestion_code`, `maybe_suggest_expect_for_unwrap`),
`ArgMatchingCtxt` (`deref`, `new`, `suggest_confusable`, `check_compatible`, `remove_idx_is_perfect`), `ArgsCtxt`
(`deref`, `new`, `normalize_span`, `provided_arg_tys`, `similar_assoc`, `call_is_in_macro`), `CallCtxt` (`deref`, `new`,
`call_metadata`, `mk_trace`, `ty_to_snippet`, `first_incompatible_error`), and `same_type_modulo_vars` with its
`SameModuloVars` `TypeRelation` (`cx`, `relate_ty_args`, `relate_with_variance`, `tys`, `regions`, `consts`, `binders`).
All `unported_methods(..)` lists of the file and the `FindClosureArg = unknown` alias are gone. Markers are in upstream
order (checked).

## Files touched
- `src/rustc_hir_typeck/fn_ctxt/checks.ts`: the `// ==== lane typeck-checks-b: checks.rs:1669..3710 ====` section
  (after checks-a's section) and this lane's imports at the top (suffixes `R` / `A` where names clash).
- New: `src/rustc_hir_typeck/fn_ctxt/checks_b.test.ts` + `checks_test/{arity,generics,closures,tuples,stop_method,
  stop_single,stop_note}.{rs,stderr,exit}` (fixtures are tydump-probe output; `REGEN=1` rewrites them).
- No decls.ts, gen, tools, harness or scripts change.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs`: 73/73 ported.
- `bun scripts/coverage.ts --check`: `markers ok (16465; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=120000`: 129 pass, 0 fail (14 files).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_hir_typeck/fn_ctxt/checks_b.test.ts`: 8 pass (fixtures equal the
  current tydump probe; 4 MATCH cases byte-equal on stderr/exit/stdout; 3 STOP cases pinned).

## Samples (lane vs base; base = integ `52b5e37d` run from the integ worktree, `RUST_TS_AGENT=typeck-checks-b-base`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-081101-typeck-checks-b-626u` | 21 / 0 / 25 / 0 | `20261021-081230-typeck-checks-b-base-2flg` | 21 / 0 / 25 / 0 |
| thirdump-minicore (46) | `20261021-081128-typeck-checks-b-fkzj` | 21 / 0 / 25 / 0 | `20261021-081307-typeck-checks-b-base-45hd` | 21 / 0 / 25 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-081158-typeck-checks-b-a342` | 289 / 0 / 11 / 0 | `20261021-081352-typeck-checks-b-base-i1t3` | 289 / 0 / 11 / 0 |

No new DIFF; per-case status and stop identical in all three (0 changed). None of the sampled cases reaches
argument-error reporting; the lane's coverage is the checks_test cases above.

## `unported(...)` left
- None in this lane's region. The diagnostics stop at other lanes' placeholders (pinned by the STOP tests; re-pin when
  the owner lands):
  - `stop_method`: `ArgMatchingCtxt::suggest_confusable` -> `FnCtxt::confusable_method_name` (method/suggest.rs,
    typeck-suggest-a).
  - `stop_single`: `FnCallDiagCtxt::check_single_incompatible` -> `TypeErrCtxt::report_and_explain_type_error`
    (error_reporting/infer/mod.rs, errrep-infer-a).
  - `stop_note`: `labels_and_suggestion_text` (`Error::Invalid`) -> `TypeErrCtxt::note_type_err` (errrep-infer-a).
- Other callees still in other files' `unported_methods` lists: `emit_coerce_suggestions`,
  `note_source_of_type_mismatch_constraint`, `annotate_alternative_method_deref` (demand.ts), `suggest_deref_unwrap_or`
  (fn_ctxt/suggestions.ts).

## PORT decisions (please record)
1. `same_type_modulo_vars`: the fn-local `struct SameModuloVars` + its `TypeRelation` impl are a module-level class
   implementing `TypeRelation`; the provided `relate` forwards to `TypeRelation_provided.relate`. This is on the
   success path (`check_argument_types` calls it whenever the call has an expected output type, see checks-a handoff).
2. `get_hir_param_info`: `params.get(is_method as usize..params.len() - c_variadic as usize)` is a local `get_range`;
   `params.len() - 1` on an empty slice wraps in release builds so `get` returns `None`, ported as `undefined` when the
   range is out of bounds.
3. `SelectionContext::new(self)` in `label_fn_like`: `&InferCtxt` is the deref coercion of `self` (passes
   `this.infcx`), per the fnctxt-contract representation.
4. Associated fns (`FnCallDiagCtxt.new` / `.format_suggestion_text`, `ArgMatchingCtxt.new`, `ArgsCtxt.new`,
   `CallCtxt.new`) are assigned with the contract's `(X as unknown as { new: typeof X.new }).new = ..` form.

## For root
1. Record the PORT decisions above.
2. When typeck-suggest-a / errrep-infer-a merge, the three STOP cases in `checks_b.test.ts` move: re-pin them (or turn
   them into MATCH cases with `REGEN=1` fixtures if they then equal the oracle).
