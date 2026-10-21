// Port of compiler/rustc_lint/src/raw_borrows_via_references.rs. The lint static and the `declare_lint_pass!`
// expansion are generated (raw_borrows_via_references.lints.gen.ts).
import { Mutability } from "../rustc_ast_ir/lib.ts";
import type { Expr } from "../rustc_hir/hir.ts";
import { Span } from "../rustc_span/lib.ts";
import type { LateContext } from "./context.ts";
import { RawBorrowViaReference_diagnostic, type RawBorrowViaReferenceSuggestion } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { RAW_BORROWS_VIA_REFERENCES, RawBorrowsViaReferences } from "./raw_borrows_via_references.lints.gen.ts";

export * from "./raw_borrows_via_references.lints.gen.ts";

declare module "./raw_borrows_via_references.lints.gen.ts" {
  interface RawBorrowsViaReferences extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for RawBorrowsViaReferences
// rustc: compiler/rustc_lint/src/raw_borrows_via_references.rs:54 check_expr
RawBorrowsViaReferences.prototype.check_expr = function (this: RawBorrowsViaReferences, cx: LateContext, expr: Expr): void {
  if (expr.kind.$ !== "Cast") return;
  const { _0: exp, _1: ty } = expr.kind;
  if (exp.kind.$ === "AddrOf" && exp.kind._0 === "Ref" && ty.kind.$ === "Ptr" && exp.kind._2.is_syntactic_place_expr()) {
    const { _1: mutbl, _2: addr_of_exp } = exp.kind;
    let suggestion: RawBorrowViaReferenceSuggestion;
    let borrow_span;
    let addr_of_span;
    let ty_span;
    if (
      (borrow_span = Span.find_ancestor_inside_same_ctxt(exp.span, expr.span)) !== undefined &&
      (addr_of_span = Span.find_ancestor_in_same_ctxt(addr_of_exp.span, expr.span)) !== undefined &&
      (ty_span = Span.find_ancestor_in_same_ctxt(ty.span, expr.span)) !== undefined &&
      Span.can_be_used_for_suggestions(borrow_span) &&
      Span.can_be_used_for_suggestions(addr_of_span) &&
      Span.can_be_used_for_suggestions(ty_span)
    ) {
      suggestion = {
        $: "Spanful",
        left: Span.until(borrow_span, addr_of_span),
        right: Span.until(Span.shrink_to_hi(addr_of_span), Span.shrink_to_hi(ty_span)),
        mutbl: Mutability.ptr_str(mutbl),
      };
    } else {
      suggestion = { $: "Spanless", mutbl: Mutability.ptr_str(mutbl) };
    }

    cx.emit_span_lint(RAW_BORROWS_VIA_REFERENCES, expr.span, RawBorrowViaReference_diagnostic({ suggestion }));
  }
};
