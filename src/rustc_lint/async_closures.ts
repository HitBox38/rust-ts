// Port of compiler/rustc_lint/src/async_closures.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (async_closures.lints.gen.ts); the `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` structs
// `ClosureReturningAsyncBlock` / `AsyncClosureSugg` are generated into async_closures.gen.ts (tools/codegen set
// `rustc_lint`).
import type * as hir from "../rustc_hir/hir.ts";
import { Span } from "../rustc_span/lib.ts";
import { ClosureReturningAsyncBlock_diagnostic } from "./async_closures.gen.ts";
import { AsyncClosureUsage, CLOSURE_RETURNING_ASYNC_BLOCK } from "./async_closures.lints.gen.ts";
import type { LateContext } from "./context.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./async_closures.gen.ts";
export * from "./async_closures.lints.gen.ts";

declare module "./async_closures.lints.gen.ts" {
  interface AsyncClosureUsage extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for AsyncClosureUsage
// rustc: compiler/rustc_lint/src/async_closures.rs:60 check_expr
AsyncClosureUsage.prototype.check_expr = function (this: AsyncClosureUsage, cx: LateContext, expr: hir.Expr): void {
  if (!(expr.kind.$ === "Closure" && expr.kind._0.kind.$ === "Closure")) {
    return;
  }
  const { body: body_id, fn_decl_span } = expr.kind._0;

  let body = cx.tcx.hir_body(body_id).value;

  // Only peel blocks that have no expressions.
  while (body.kind.$ === "Block" && body.kind._1 === undefined && body.kind._0.stmts.length === 0 && body.kind._0.expr !== undefined) {
    const tail = body.kind._0.expr;
    body = tail;
  }

  if (
    !(
      body.kind.$ === "Closure" &&
      body.kind._0.kind.$ === "Coroutine" &&
      body.kind._0.kind._0.$ === "Desugared" &&
      body.kind._0.kind._0._0 === "Async" &&
      body.kind._0.kind._0._1 === "Block"
    )
  ) {
    return;
  }
  const async_decl_span = body.kind._0.fn_decl_span;

  const deletion_span = cx.tcx.sess.source_map().span_extend_while_whitespace(async_decl_span);

  cx.tcx.emit_node_span_lint(
    CLOSURE_RETURNING_ASYNC_BLOCK,
    expr.hir_id,
    fn_decl_span,
    ClosureReturningAsyncBlock_diagnostic({
      async_decl_span,
      sugg: {
        deletion_span,
        insertion_span: Span.shrink_to_lo(fn_decl_span),
      },
    }),
  );
};
