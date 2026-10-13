// compiler/rustc_lint/src/precedence.rs. The lint static and the `declare_lint_pass!` expansion are generated
// (precedence.lints.gen.ts).
import type { ast } from "../rustc_ast/lib.ts";
import { Span } from "../rustc_span/lib.ts";
import type { EarlyContext } from "./context.ts";
import { AmbiguousNegativeLiteralsDiag_diagnostic } from "./diagnostics.gen.ts";
import type { EarlyLintPass } from "./passes.ts";
import { AMBIGUOUS_NEGATIVE_LITERALS, Precedence } from "./precedence.lints.gen.ts";

export * from "./precedence.lints.gen.ts";

declare module "./precedence.lints.gen.ts" {
  interface Precedence extends EarlyLintPass {}
}

// impl EarlyLintPass for Precedence
// rustc: compiler/rustc_lint/src/precedence.rs:39 check_expr
Precedence.prototype.check_expr = function (this: Precedence, cx: EarlyContext, expr: ast.Expr): void {
  if (!(expr.kind.$ === "Unary" && expr.kind._0 === "Neg")) {
    return;
  }
  const operand = expr.kind._1;

  let arg = operand;
  let at_least_one = false;
  while (arg.kind.$ === "MethodCall") {
    const receiver = arg.kind._0.receiver;
    at_least_one = true;
    arg = receiver;
  }

  if (at_least_one && arg.kind.$ === "Lit" && (arg.kind._0.kind.$ === "Integer" || arg.kind._0.kind.$ === "Float")) {
    cx.emit_span_lint(
      AMBIGUOUS_NEGATIVE_LITERALS,
      expr.span,
      AmbiguousNegativeLiteralsDiag_diagnostic({
        negative_literal: {
          start_span: Span.shrink_to_lo(expr.span),
          end_span: Span.shrink_to_hi(arg.span),
        },
        current_behavior: {
          start_span: Span.shrink_to_lo(operand.span),
          end_span: Span.shrink_to_hi(operand.span),
        },
      }),
    );
  }
};
