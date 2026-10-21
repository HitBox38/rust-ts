# Handoff: typeck-checks-a (M3 wave 18b, rustc_hir_typeck)

Branch `lane/typeck-checks-a` (from integ `a5910d3`, no merges).

## Result
Every fn of the lane's region is ported:
- `fn_ctxt/checks.rs:1..1668`: 23/23 (`check_casts`, `check_asms`, `check_repeat_exprs`, `check_argument_types` + nested
  `variadic_error`, `check_tupled_arguments`, `check_place_expr_if_unsized`, `report_arg_errors`, `suggest_mut_addr`,
  `check_expr_lit`, `check_struct_path`, `check_decl_initializer`, `check_decl`, `check_decl_local`, `check_stmt`,
  `check_block_no_value`, `check_expr_block`, `parent_item_span`, `get_expr_coercion_span`, `overwrite_local_ty_if_err`
  + `OverwritePatternsWithError::visit_pat`, `finish_resolving_struct_path`,
  `adjust_fulfillment_errors_for_expr_obligation`). The lane's `unported_methods` list is gone; checks-b's lists and
  the `same_type_modulo_vars` stub are untouched.
- `fn_ctxt/arg_matrix.rs`: 11/11 (`ArgMatrix` + `Error`'s `Ord`/`PartialOrd`, the two index conversions).
- `fn_ctxt/inspect_obligations.rs`: 13/13 (7 FnCtxt methods; hand classes `NestedObligationsForSelfTy` and
  `FindFromFloatForF32RootVids` implementing `ProofTreeVisitor<undefined>`, replacing the `export type X = unknown`
  aliases; the generated `.gen.ts` re-exports them unchanged).

## Files touched
- `src/rustc_hir_typeck/fn_ctxt/checks.ts` (only the `// ==== lane typeck-checks-a` section, inserted before checks-b's
  lists; imports of this lane live inside that section).
- `src/rustc_hir_typeck/fn_ctxt/arg_matrix.ts`, `src/rustc_hir_typeck/fn_ctxt/inspect_obligations.ts` (whole files).
- New: `src/rustc_hir_typeck/fn_ctxt/arg_matrix.test.ts` (8 tests: diagonal, swap, missing, extra, invalid, 3-cycle
  permutation, `Error` ordering, index conversions; expectations traced by hand through the upstream algorithm).
- No decls.ts, gen, tools, harness or scripts change.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs`: 23/73 (all 23 of lines 1..1668;
  the 50 missing are checks-b's, from :1670).
- `.../fn_ctxt/arg_matrix.rs`: 11/11. `.../fn_ctxt/inspect_obligations.rs`: 13/13.
- `bun scripts/coverage.ts --check`: `markers ok (15210; vendor 3888)`.

## `unported(...)` left
- `FnCtxt::check_expr_lit` (checks.rs:1045), an unsuffixed integer literal whose expectation is a pattern type
  (`ty::Pat(base, _)` with integral `base`): needs `tcx.layout_of` (rustc_middle ty/layout.rs, M4). Only with
  `#![feature(pattern_types)]`.
- Calls that reach other lanes' placeholders (expected until merge): see "Cross-lane needs".

## PORT decisions (please record)
1. **Lane imports in a split file** (checks.ts): this lane's imports sit in its own section with an `A` suffix
   (`TyA`, `hirA`, `SpanA`, ...) so they cannot collide with checks-b's imports in the same file at merge.
2. **arg_matrix companions**: `impl ExpectedIdx` / `impl ProvidedIdx` are `ExpectedIdx.to_provided_idx(i)` /
   `ProvidedIdx.to_expected_idx(i)` on companions spreading the generated `newtype_index` ones; `impl Ord/PartialOrd for
   Error` are `Error.cmp(a, b)` / `Error.partial_cmp(a, b)` on a new companion `Error` (the type had none);
   `core::cmp::Ordering` is the comparator `-1 | 0 | 1` (`errors.sort()` -> `errors.sort(Error.cmp)`, both stable).
   `ArgMatrix::new` is the associated fn `ArgMatrix.new` (namespace augmentation in arg_matrix.ts, decls.ts precedent);
   the methods are on `ArgMatrix.prototype`. `Option<Option<usize>>` in `find_issue` is `{ $: "Some", _0 } | undefined`.
3. **ProofTreeVisitor impls**: classes with `readonly Result = VisitorResult.unit` (`type Result = ()`), the provided
   `on_recursion_limit` written out as `this.Result.output()`; `&'a mut` fields are the caller's array / `Set`.
   `UnordSet<FloatVid>` is `Set<FloatVid>` (decls.ts). The field `span` of `FindFromFloatForF32RootVids` is `span_`
   (it collides with the trait method `span()`).
4. **`FxIndexSet<(Span, Predicate, ObligationCause)>`** in `adjust_fulfillment_errors_for_expr_obligation`: a
   `KeyedSet` keyed by `intern_key` (the derived `Eq`; insertion-ordered as `IndexSet`). Dedup matters there: the inner
   loop's `continue` does not stop it, so the *last* matching entry wins.
5. **`TypeErrCtxt` methods** (`consider_removing_semicolon`, `consider_returning_binding`, suggest.rs:434 / :1020) are
   called through a local interface `TypeErrCtxt_suggest` (`// PORT(decls): pending root`), because `TypeErrCtxt` is
   `Pending` until errctxt-contract (wave 19). Unreachable today (`err_ctxt()` is unported).
6. **`InlineAsmCtxt::new(..).check_asm(..)`** (inline_asm.rs, lane typeck-expr-b; comment-only declarations) is called as
   the associated fn `InlineAsmCtxt.new` through a structural cast (`// PORT(decls)`): if typeck-expr-b picks another
   form, adjust `check_asms` at merge.
7. Smaller ones, commented in place: `Option<Option<Vec>>::unwrap_or_default()` flattened to `Ty[] | undefined`;
   `Itertools::zip_eq` panic kept; `usize -> u16` `try_into().unwrap()` panic kept; `check_stmt` re-reads `stmt.kind`
   without TS's narrowing of the first `match`; `get_expr_coercion_span`'s lazy `filter_map` advanced at most twice;
   `retain` / `retain_mut` as `filter` (the `retain_mut` closure writes the resolved predicate back first).

## Cross-lane needs
- **`same_type_modulo_vars` (checks.rs:3615, lane typeck-checks-b) is on the success path**: `check_argument_types` calls
  it for every argument whenever the call has an expected output type (`let x: T = f(..)`, nested calls, ...), and it
  needs the `SameModuloVars` `TypeRelation` (checks.rs:3620..3700). The split table calls checks-b "error path only,
  root may move it to wave 19": these ~100 lines must not move with it.
- Success-path callees in other lanes (placeholders today): `check_expr*`, `check_expr_with_expectation`,
  `check_expr_coercible_to_type`, `check_expr_has_type_or_error` (expr-a), `coerce`, `CoerceMany.new` / `coerce_inner` /
  `coerce_forced_unit` / `merged_ty` / `complete`, `demand_suptype`, `demand_eqtype_with_origin`, `demand_eqtype_diag`
  (coerce), `normalize`, `structurally_resolve_*`, `register_wf_obligation`, `require_type_*`, `write_ty`, `local_ty`,
  `with_breakable_ctxt`, `select_obligations_where_possible`, `warn_if_unreachable`, `err_args`, `write_splatted_call`,
  `write_resolution`, `write_user_type_annotation_from_args`, `add_required_obligations_for_hir`, `get_fn_decl`,
  `node_ty`, `deeply_resolve_ignoring_regions_with_obligations`, `FnCtxt.user_args_for_adt`,
  `adjust_fulfillment_error_for_expr_obligation` (impl / adjust_fulfillment_errors), `check_pat_top` (pat-a),
  `CastCheck.check` (callee-cast), `InlineAsmCtxt.new` (expr-b), `root_float_vid` (fallback.rs, lib-wb).
- Error path (wave 19 / checks-b): `FnCallDiagCtxt.new` and its methods, `label_fn_like`, `emit_type_mismatch_suggestions`,
  `suggest_block_to_brackets`, `suggest_boxing_when_appropriate`, `suggest_semicolon_at_end`,
  `is_next_stmt_expr_continuation`, `comes_from_while_condition`, `err_ctxt`, `ExprParenthesesNeeded::surrounding`
  (diagnostics.ts stub).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=60000`: 20 pass / 0 fail (contract.test.ts 12, arg_matrix.test.ts 8).
- `bun scripts/coverage.ts --check`: ok. No pre-existing test's pinned stop moved (nothing re-pinned).

## Samples
Base = integ `a5910d3` in a temporary detached worktree (`RUST_TS_AGENT=checks-a-base0`, since removed), lane = this
branch (`RUST_TS_AGENT=typeck-checks-a`), same `--seed typeck-checks-a`. Every case has the same status and the same
stop as on base (compared per case from the run jsonl): no new DIFF, no new UNPORTED, no stop change. No sampled case
reaches a typeck body yet: every typeck stops first at `rustc_hir_typeck::loops::check` (typeck-lib-wb), and most cases
stop earlier still.

| suite | run | MATCH | DIFF | UNPORTED | CRASH | base |
|---|---|---|---|---|---|---|
| tydump-nocore `--sample 100` | `20261015-081341-typeck-checks-a-bh6v` | 81 | 0 | 19 | 0 | `20261015-081610-checks-a-base0-lcib`: 81 / 0 / 19 / 0 |
| tydump-minicore (46, full) | `20261015-081438-typeck-checks-a-b8eh` | 5 | 0 | 41 | 0 | `20261015-081611-checks-a-base0-5wqu`: 5 / 0 / 41 / 0 |
| hir-tree-nocore `--sample 100` | `20261015-081509-typeck-checks-a-nsyf` | 100 | 0 | 0 | 0 | (fnctxt-contract: 100 / 0 / 0 / 0) |

Top stops (lane = base): tydump-nocore: `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)` (cache) 4,
`check_unused_traits provider` 4, `EarlyParamRegion: RegionName::is_named` 3, `IntegerExt::to_ty` (M4) 2;
tydump-minicore: old solver `FulfillmentContext::new` 34, `check_unused_traits provider` 3, `StableHash without a TS
impl` 2.
