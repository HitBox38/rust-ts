// Port of compiler/rustc_lint/src/implicit_provenance_casts.rs. The lint static and the `declare_lint_pass!`
// expansion are generated (implicit_provenance_casts.lints.gen.ts).
//
// PORT: `LateContext::typeck_results` is `typeck_results_()` (the field shares the name); context.ts types it and
// `precedence()` as `unknown`, so the call sites cast them (`TypeckResults`, `ExprPrecedence`). `ExprPrecedence`'s
// derived `PartialOrd` compares `ExprPrecedence_discriminant`.
import type { ExprPrecedence } from "../rustc_ast/util/parser.ts";
import { ExprPrecedence_discriminant } from "../rustc_ast/util/parser.gen.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Span } from "../rustc_span/lib.ts";
import type { LateContext } from "./context.ts";
import {
  ImplicitProvenanceCastsInt2Ptr_diagnostic,
  ImplicitProvenanceCastsPtr2Int_diagnostic,
  type Int2PtrSuggestion,
  type Ptr2IntSuggestion,
} from "./diagnostics.ts";
import { IMPLICIT_PROVENANCE_CASTS, ImplicitProvenanceCasts } from "./implicit_provenance_casts.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./implicit_provenance_casts.lints.gen.ts";

declare module "./implicit_provenance_casts.lints.gen.ts" {
  interface ImplicitProvenanceCasts extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for ImplicitProvenanceCasts
// rustc: compiler/rustc_lint/src/implicit_provenance_casts.rs:64 check_expr
ImplicitProvenanceCasts.prototype.check_expr = function (this: ImplicitProvenanceCasts, cx: LateContext, expr: hir.Expr): void {
  if (expr.kind.$ !== "Cast") return;
  const cast_from_expr = expr.kind._0;
  const cast_to_hir = expr.kind._1;

  const typeck_results = cx.typeck_results_() as TypeckResults;
  const cast_from_ty = typeck_results.expr_ty(cast_from_expr);
  if (cast_from_ty.is_raw_ptr()) {
    const cast_to_ty = typeck_results.expr_ty(expr);
    if (cast_to_ty.is_integral()) {
      lint_ptr2int(cx, expr, cast_from_expr, cast_from_ty, cast_to_hir, cast_to_ty);
    }
  } else if (cast_from_ty.is_integral()) {
    const cast_to_ty = typeck_results.expr_ty(expr);
    if (cast_to_ty.is_raw_ptr()) {
      lint_int2ptr(cx, expr, cast_from_expr, cast_from_ty, cast_to_hir, cast_to_ty);
    }
  }
};

// rustc: compiler/rustc_lint/src/implicit_provenance_casts.rs:83 lint_ptr2int
function lint_ptr2int(cx: LateContext, expr: hir.Expr, cast_from_expr: hir.Expr, cast_from_ty: Ty, cast_to_hir: hir.Ty, cast_to_ty: Ty): void {
  let sugg: Ptr2IntSuggestion | undefined;
  if (Span.can_be_used_for_suggestions(expr.span)) {
    const needs_parens = ExprPrecedence_discriminant[cx.precedence(cast_from_expr) as ExprPrecedence] < ExprPrecedence_discriminant.Unambiguous;
    const needs_cast = !cast_to_ty.is_usize();
    const cast_span = Span.to(Span.shrink_to_hi(cast_from_expr.span), cast_to_hir.span);
    const expr_span = Span.shrink_to_lo(cast_from_expr.span);
    if (needs_parens && needs_cast) {
      sugg = { $: "NeedsParensCast", expr_span, cast_span, cast_to_ty };
    } else if (needs_parens && !needs_cast) {
      sugg = { $: "NeedsParens", expr_span, cast_span };
    } else if (!needs_parens && needs_cast) {
      sugg = { $: "NeedsCast", cast_span, cast_to_ty };
    } else {
      sugg = { $: "Other", cast_span };
    }
  } else {
    sugg = undefined;
  }

  const lint = ImplicitProvenanceCastsPtr2Int_diagnostic({ cast_from_ty, cast_to_ty, sugg });
  cx.tcx.emit_node_span_lint(IMPLICIT_PROVENANCE_CASTS, expr.hir_id, expr.span, lint);
}

// rustc: compiler/rustc_lint/src/implicit_provenance_casts.rs:108 lint_int2ptr
function lint_int2ptr(cx: LateContext, expr: hir.Expr, cast_from_expr: hir.Expr, cast_from_ty: Ty, cast_to_hir: hir.Ty, cast_to_ty: Ty): void {
  const sugg: Int2PtrSuggestion | undefined = Span.can_be_used_for_suggestions(expr.span)
    ? {
        lo: Span.shrink_to_lo(cast_from_expr.span),
        hi: Span.to(Span.shrink_to_hi(cast_from_expr.span), cast_to_hir.span),
      }
    : undefined;
  const lint = ImplicitProvenanceCastsInt2Ptr_diagnostic({ expr_ty: cast_from_ty, cast_ty: cast_to_ty, sugg });
  cx.tcx.emit_node_span_lint(IMPLICIT_PROVENANCE_CASTS, expr.hir_id, expr.span, lint);
}
