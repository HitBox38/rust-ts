# Handoff: typeck-fnsugg-a (M3 wave 19, error reporting)

Branch `lane/typeck-fnsugg-a` (from integ `52b5e37d`, no merges). Assignment: row 15 of the split table in
`docs/handoff/errctxt-contract.md`: `compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1..2025` and
`method/prelude_edition_lints.rs` except :156/:273.

Commits: `245b07f3` port (previous agent, cut off by a usage limit before the handoff); then a resumed review commit
(this handoff, the review fixes below, the unit tests).

## Files touched
- `src/rustc_hir_typeck/fn_ctxt/suggestions.ts`: 32 fns ported in upstream order (`suggest_semicolon_at_end` :51 ..
  `suggest_associated_const` :1947, incl. the nested `is_in_arm` :1419). `fn_sig` :43 and `is_field_suggestable` :2297
  were already ported (typeck-gaps). Lane b's 17 placeholders stay in their `unported_methods` list under
  `// ==== lane typeck-fnsugg-b`.
- `src/rustc_hir_typeck/method/prelude_edition_lints.ts`: the three `impl Diagnostic`s (:28 `AmbiguousTraitMethodCall`,
  :95 `AmbiguousTraitMethod`, :293 the fn-local `AmbiguousTraitAssocFunc`), `trait_path_or_bare_name` :416,
  `trait_path` :428, `adjust_expr` :470.
- `src/rustc_hir_typeck/fnsugg_a.test.ts` (new): 8 tests, fake-`FnCtxt`-receiver style (precedent typeck_impl.test.ts),
  real `SourceMap` / `DiagCtxt` with a recording emitter: `suggest_semicolon_at_end`, `is_next_stmt_expr_continuation`,
  `suggest_floating_point_literal` (hex `f32`/`f64`, rejections), `suggest_null_ptr_for_literal_zero_given_to_ptr_arg`,
  `suggest_block_to_brackets_peeling_refs` + `suggest_block_to_brackets`, `adjust_expr` (all adjustments, imprecise),
  `trait_path_or_bare_name` / `trait_path` (single / `_` / glob / none), `AmbiguousTraitMethodCall` into_diag
  (message, suggestion, snippet-less help). Typeck of real bodies does not reach these fns yet, so there is no oracle test.

## Review fixes (resumed session)
PORTING §3 forbids deduplication; the first commit had merged code that upstream writes twice into helpers. Inlined:
- `sugg_call_for_inputs` → the `match inputs.len()` in both `suggest_fn_call` and `suggest_two_fn_call`;
- `if_else_stmt_followed_by_continuation` → the `if let` chain in both arms of `suggest_missing_semicolon`;
- `autoref_str` → the `match pick.autoref_or_ptr_adjustment` in both `AmbiguousTraitMethodCall::into_diag` and `adjust_expr`.
The remaining fns were checked line by line against upstream (strings, arm order, guards, spans, iterator semantics);
no other divergence found.

## Coverage
- `fn_ctxt/suggestions.rs`: 34/51 (base 2/51); the 17 missing are lane typeck-fnsugg-b's (:2027 `is_loop` ..
  :3925 `suggest_swapping_lhs_and_rhs`). Region 1..2025: complete.
- `method/prelude_edition_lints.rs`: 8/8 (base 2/8).
- rustc_hir_typeck 876/1041 (base 838); TOTAL 15942/25518 (base 15904).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (16461; vendor 3888).
- `bun test src/rustc_hir_typeck`: 129 pass, 0 fail (14 files). `errctxt_contract.test.ts` + rustc_infer
  `contract.test.ts`: 16 pass.

## Samples (lane vs base; base = integ `52b5e37d`, `RUST_TS_AGENT=typeck-fnsugg-a-base`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-081954-typeck-fnsugg-a-01yd` | 21 / 0 / 25 / 0 | `20261021-081955-typeck-fnsugg-a-base-0bii` | 21 / 0 / 25 / 0 |
| thirdump-minicore (46) | `20261021-082123-typeck-fnsugg-a-gy9j` | 21 / 0 / 25 / 0 | `20261021-082122-typeck-fnsugg-a-base-uwdy` | 21 / 0 / 25 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-082303-typeck-fnsugg-a-pxo3` | 289 / 0 / 11 / 0 | `20261021-082253-typeck-fnsugg-a-base-4xtc` | 289 / 0 / 11 / 0 |

No new DIFF; per-case statuses and UNPORTED stops identical to base (no stop was in this region; the top minicore stop
is still `TypeErrCtxt::note_type_err`, 12 cases).

## `unported(...)` left
None in the ported code. Calls into still-unported code stop there: lane b's `is_loop`, `is_local_statement`,
`suggest_cast`, `suggest_deref_or_ref` (all called from this region), and `TypeErrCtxt` placeholders
(`extract_callable_info`, `should_suggest_as_ref`).

## `// PORT:` decisions
- File header notes (suggestions.ts): `debug!` / `#[instrument]` stay comments; `self.err_ctxt()` is the contract's
  `TypeErrCtxt`, a `&FnCtxt` passed as `&InferCtxt` is `this.infcx`; `impl FnOnce` closures are plain fns; `Ord` on
  `Applicability` / `ExprPrecedence` compares the `*_discriminant` tables (`applicability_max`, `precedence_lt` helpers,
  derived `Ord` in declaration order); `format!("{ty}")` is `display_Ty`, of a `Symbol` `Symbol.as_str`.
- suggestions.ts `suggest_deref_ref_or_into`: the `filter_map(..).peekable()` closure is pure, so the suggestions are
  collected eagerly (`peek().is_some()` → `length !== 0`).
- suggestions.ts `try_suggest_return_impl_trait`: `.filter_map(..).map(..).collect::<Result<Vec<_>, _>>()` stops at the
  first `Err` (lowering is lazy, so later bounded types are not lowered).
- suggestions.ts `suggest_associated_const`: `str::to_uppercase` is `String.prototype.toUpperCase` (both Unicode full
  case mapping).
- prelude_edition_lints.ts: `impl Diagnostic for X` is `X_into_diag(self, dcx, level)` plus `X_diagnostic(self)` (the
  `Diagnostic` trait object passed to `emit_node_span_lint`); `AmbiguousTraitAssocFunc` and its impl stay local to
  `lint_fully_qualified_call_from_2018`.

## For root
- Nothing outside the assigned files was edited (besides the new test file and this handoff).
- `lint_edition_dependent_dot_call` (:156, lane typeck-method) evaluates `self_ty.boxed_ty()` before the `Array` check
  instead of inside the `else if`; `boxed_ty` is pure so output is unaffected, left as is (not this lane's fn).
