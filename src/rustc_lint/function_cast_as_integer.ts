// Port of compiler/rustc_lint/src/function_cast_as_integer.rs. The lint static and the `declare_lint_pass!`
// expansion are generated (function_cast_as_integer.lints.gen.ts).
//
// PORT: `LateContext::typeck_results` is `typeck_results_()` (the field shares the name); context.ts types it
// `unknown`, so the call sites cast it to `TypeckResults`.
import type * as hir from "../rustc_hir/hir.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { BytePos, Span } from "../rustc_span/lib.ts";
import type { LateContext } from "./context.ts";
import { FunctionCastsAsIntegerDiag_diagnostic } from "./diagnostics.ts";
import { FUNCTION_CASTS_AS_INTEGER, FunctionCastsAsInteger } from "./function_cast_as_integer.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./function_cast_as_integer.lints.gen.ts";

declare module "./function_cast_as_integer.lints.gen.ts" {
  interface FunctionCastsAsInteger extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for FunctionCastsAsInteger
// rustc: compiler/rustc_lint/src/function_cast_as_integer.rs:38 check_expr
FunctionCastsAsInteger.prototype.check_expr = function (this: FunctionCastsAsInteger, cx: LateContext, expr: hir.Expr): void {
  if (expr.kind.$ !== "Cast") return;
  const cast_from_expr = expr.kind._0;
  const cast_to_expr = expr.kind._1;
  const cast_to_ty = (cx.typeck_results_() as TypeckResults).expr_ty(expr);
  // Casting to a function (pointer?), so all good.
  //
  // Normally, only casts to integers is possible, but if it ever changed, this condition
  // will likely need to be updated.
  const to_kind = cast_to_ty.kind();
  if (to_kind.$ === "FnDef" || to_kind.$ === "FnPtr" || to_kind.$ === "RawPtr") {
    return;
  }
  const cast_from_ty = (cx.typeck_results_() as TypeckResults).expr_ty(cast_from_expr);
  if (cast_from_ty.kind().$ === "FnDef") {
    cx.tcx.emit_node_span_lint(
      FUNCTION_CASTS_AS_INTEGER,
      expr.hir_id,
      Span.with_lo(cast_to_expr.span, BytePos.add(Span.hi(cast_from_expr.span), BytePos(1))),
      FunctionCastsAsIntegerDiag_diagnostic({
        sugg: {
          suggestion: Span.shrink_to_hi(cast_from_expr.span),
          cast_to_ty,
        },
      }),
    );
  }
};
