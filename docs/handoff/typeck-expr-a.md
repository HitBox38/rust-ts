# Handoff: typeck-expr-a (M3 wave 18b, rustc_hir_typeck): expr.rs:1..1854, op.rs

Branch `lane/typeck-expr-a` (from integ `a5910d3`, no merges).

## Result
- **expr.rs:1..1854: 39/39** `FnCtxt` methods ported in upstream order (`precedence` .. `check_expr_struct`), incl. the
  whole `check_expr*` family, `check_expr_kind` (every `ExprKind` arm), unop / addr_of / named place / path / break /
  continue / return / become / return-or-body-tail / if / assign (+ `expr_assign_expected_bool_error`) / let / loop /
  method call / use / cast / unsafe binder cast / array / const block / repeat / tuple / struct, and the error helpers
  in this region (`emit_return_outside_of_fn_body`, `point_at_return_for_opaque_ty_error`, `check_lhs_assignable`,
  `check_for_missing_semi`, `comes_from_while_condition`).
- **op.rs: 25/25**: the 15 `FnCtxt` methods (binops, assign-ops, user unops, `lookup_op_method`, all error reporting
  helpers), the 5 free fns (`lang_item_for_binop`, `lang_item_for_unop`, `contains_let_in_chain`,
  `deref_ty_if_possible`, `is_builtin_binop`), the two `From` impls of `BinOpCategory` and `impl Op`.
- No `unported(..)` call of my own; every stop reachable from this code is another lane's placeholder or a wave-19
  function (see "Stops reachable from this code").

## Files
- `src/rustc_hir_typeck/expr.ts` (filled the expr-a region; expr-b's `unported_methods` list kept unchanged at the end).
- `src/rustc_hir_typeck/op.ts` (whole file).
- `src/rustc_hir_typeck/expr_a.test.ts` (new, 11 tests).
- `docs/handoff/typeck-expr-a.md`.
- Nothing outside these files (decls.ts untouched).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/op.rs`: **25/25 ported**.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/expr.rs`: **39/67** (missing: exactly the 28 fns of
  expr.rs:1856.. = lane typeck-expr-b).
- `bun scripts/coverage.ts --check`: `markers ok (15227; vendor 3888)`.

## PORT decisions (please record)
1. **`PORT(decls): pending root` — `CoerceMany` type mismatch in decls.ts.** decls.ts imports `type CoerceMany` from
   `./coercion.gen.ts` (the *generated* class, field `expected_ty`, no methods), so `FnCtxt.ret_coercion` and
   `if_fallback_coercion(.., coercion: CoerceMany)` are typed with it; but the class instantiated at runtime and carrying
   the methods (`declare module "./coercion.ts"`) is coercion.ts's **hand** class (`expected_ty_`). expr.ts bridges with
   two casts: `ret_coercion_of(fcx)` (gen -> hand) and `as_gen_CoerceMany(c)` (hand -> gen).
   **Root fix:** in decls.ts import `CoerceMany` from `./coercion.ts` (and stop codegen from emitting the class into
   coercion.gen.ts, since types.sets.json marks it `hand`); then drop the two helpers. Lanes typeck-coerce / typeck-impl
   (`_match.rs` uses `ret_coercion` too) likely hit the same.
2. **`PORT(decls): pending root` — `TypeErrCtxt` methods.** `TypeErrCtxt` is `Pending` (rustc_trait_selection
   decls.ts), so `self.err_ctxt().ty_kind_suggestion(..)` / `.note_field_shadowed_by_private_candidate(..)` /
   `.suggest_restricting_param_bound(..)` go through `err_ctxt_methods(fcx)` (expr.ts: `fcx.err_ctxt()` cast to a local
   `TypeErrCtxtMethods` interface with the upstream signatures). `err_ctxt()` itself still stops first. Exported, so
   op.ts and expr-b can use it; root replaces it with the real type in wave 19 (errctxt-contract).
3. `(a, b).error_reported()` on `(Ty, Ty)`: `TypeVisitableExt.error_reported([a, b], d_Ty_Ty_visitable)`, a local
   `TypeVisitable<[Ty, Ty]>` descriptor over `visit_with_tuple2` (expr.ts, exported).
4. `BinOpCategory`'s two `impl From<..>` are `BinOpCategory.from_BinOpKind` / `.from_AssignOpKind` on the companion const
   (precedent `UnsafeBinderInner.from_Binder`); `impl Op { span, as_str, is_by_value }` is the companion const `Op`
   (op.ts re-exports both over the generated types). `#[derive(PartialEq)]` on `Op` is never used.
5. `self.diverges` / `is_whole_body` / `ret_coercion_span` (`Cell`s): `.get()/.set()/.replace()` are reads/writes of the
   plain fields; `a | b`, `a & b` on `Diverges` are `Diverges.bitor/bitand` (Rust precedence kept:
   `cond | then & else` = `bitor(cond, bitand(then, else))`).
6. `check_expr_with_expectation_and_args`: the `-Zverbose-internals` block computes the snippet but only feeds
   `debug!` (not ported), kept as a no-op with a comment.
7. `ty.fn_sig(tcx).inputs()` etc. use the `PolyFnSig` companion imported as **`PolyFnSigC`** (same alias as lane
   typeck-expr-b, to ease the merge).

## Stops reachable from this code (all error paths; none on a success path)
| reached from | stop | owner |
|---|---|---|
| `check_expr_has_type_or_error` (mismatch) | `emit_type_mismatch_suggestions` | demand.rs, wave 19 |
| `check_expr_unop` (`*x` on non-deref type) | `ExprParenthesesNeeded::surrounding` (only with a stashed span), `suggest_fn_call` | diagnostics.ts stub / fn_ctxt/suggestions.rs, wave 19 |
| `check_user_unop` (no `Not`/`Neg` impl) | `note_unmet_impls_on_type` | method/suggest.rs, wave 19 |
| `check_overloaded_binop` (rhs mismatch), `report_binop_fulfillment_errors`, `check_expr_break` (forced unit mismatch) | `FnCtxt::err_ctxt` | wave 19 |
| `report_binop_fulfillment_errors` (assign-op) | `maybe_emit_plus_equals_diagnostic` | diagnostics.ts manual impl stub |
| `check_expr_path` (`Res::Err`) | `suggest_assoc_method_call` | method/suggest.rs, wave 19 |
| `emit_return_outside_of_fn_body` (`return` in a const) | `<ReturnLikeStatementKind as IntoDiagArg>::into_diag_arg` | diagnostics.ts manual impl stub (tiny; worth pulling forward) |

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=60000`: 23 pass / 0 fail (contract.test.ts 12 + expr_a.test.ts 11). No
  pre-existing test pin moved.
- Samples (lane = this branch, `RUST_TS_AGENT=typeck-expr-a`; base = a detached worktree at `a5910d3`,
  `RUST_TS_AGENT=typeck-expr-a-base0`, same `--seed`); per-case status **and** stop compared: **0 cases changed**.

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-081340-typeck-expr-a-0p5l` | 5 | 0 | 41 | 0 | `20261015-081907-typeck-expr-a-base0-a2sg`: 5/0/41/0 |
| tydump-nocore `--sample 100 --seed typeck-expr-a` | `20261015-081405-typeck-expr-a-7xt6` | 79 | 0 | 21 | 0 | `20261015-081739-typeck-expr-a-base0-mbrn`: 79/0/21/0 |
| hir-tree-nocore `--sample 100 --seed typeck-expr-a` | `20261015-081509-typeck-expr-a-ikum` | 100 | 0 | 0 | 0 | (pre-typeck suite) |

  Top stops (none in typeck): minicore — `FulfillmentContext::new` (old solver) 34, `check_unused_traits provider` 3,
  `StableHash without a TS impl` 2; nocore — `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool) (cache)` 8 (every
  fn / impl wfcheck), `QueryKey for LitToConstInput (cache)` 3, `ConstraintCategory (mir, M4)` 2, `IntegerExt::from_int_ty` 2.
  So the samples never reach a typeck body yet.
- **Integration smoke test** (temporary detached worktree, deleted): integ `372b3d8` + this branch + lanes lib-wb, impl,
  checks-a, coerce, callee-cast, method, probe, euv, upvar, expr-b merged cleanly except **expr.ts vs typeck-expr-b**
  (conflict only in the header/import block; resolved by taking both import blocks and dropping duplicate bindings);
  pat-a and selcx-contract conflicted elsewhere and were left out. tsc clean, `bun test src/rustc_hir_typeck` 41 pass.
  19 hand-written single-body `#![no_core]` crates through `src/rust_ts/tydump.ts` vs the tydump probe: tuple / if-else /
  `loop { break v }` / `&&`-`||` / `&e` / `*&e` / path to const / `as` / `loop { break }` / `while` bodies all type-check
  through expr.rs and stop at `fallback::type_inference_fallback` (lib-wb); `&raw const 1` emits E0745 byte-identical to
  the oracle, then the same stop; `let` stops at `check_pat_top` (pat-a); `!true` / `-1` / `1 < 2` / `1 + 2` without lang
  items stop at the wave-19 functions in the table above; fn bodies stop earlier in wfcheck (implied-bounds query key).

## For root / merge
1. Merge conflict with **typeck-expr-b** in `src/rustc_hir_typeck/expr.ts`, header + imports only: keep this lane's
   header comment, then the union of both import lists (drop duplicate bindings; expr-b imports `PolyFnSig` as a type
   from decls and `PolyFnSigC` from ty_kind, as here). Both lanes removed their own `unported_methods` list, so after the
   merge expr.ts has none.
2. Record decisions 1-2 above and fix decls.ts `CoerceMany` (decision 1).
3. The `ReturnLikeStatementKind` `IntoDiagArg` stub (diagnostics.ts) is the only stop of `return`/`become` outside a fn
   body; small, could go with any wave-18 follow-up.
