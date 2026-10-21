// Port of compiler/rustc_lint/src/interior_mutable_consts.rs. The lint static and the `declare_lint_pass!` expansion
// are generated (interior_mutable_consts.lints.gen.ts).
//
// PORT: `LateContext::typeck_results` is `typeck_results_()` (the field shares the name); context.ts types it and
// `qpath_res` as `unknown`, so the call sites cast them (`TypeckResults`, `Res`).
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type { Expr } from "../rustc_hir/hir.ts";
import { HasAttrs_DefId } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import type { LateContext } from "./context.ts";
import { ConstItemInteriorMutationsDiag_diagnostic, type ConstItemInteriorMutationsSuggestionStatic } from "./diagnostics.ts";
import { CONST_ITEM_INTERIOR_MUTATIONS, InteriorMutableConsts } from "./interior_mutable_consts.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./interior_mutable_consts.lints.gen.ts";

declare module "./interior_mutable_consts.lints.gen.ts" {
  interface InteriorMutableConsts extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for InteriorMutableConsts
// rustc: compiler/rustc_lint/src/interior_mutable_consts.rs:55 check_expr
InteriorMutableConsts.prototype.check_expr = function (this: InteriorMutableConsts, cx: LateContext, expr: Expr): void {
  const typeck = cx.typeck_results_() as TypeckResults;

  let method_did: DefId | undefined;
  let receiver: Expr;
  switch (expr.kind.$) {
    // matching on `<receiver>.method(..)`
    case "MethodCall":
      [method_did, receiver] = [typeck.type_dependent_def_id(expr.hir_id), expr.kind._1];
      break;
    // matching on `function(&<receiver>, ...)`
    case "Call": {
      const path = expr.kind._0;
      if (expr.kind._1.length < 1) return;
      const receiver_ = expr.kind._1[0]!;
      if (receiver_.kind.$ === "AddrOf") {
        const receiver__ = receiver_.kind._2;
        if (path.kind.$ === "Path") {
          const qpath = path.kind._0;
          [method_did, receiver] = [Res.opt_def_id(cx.qpath_res(qpath, path.hir_id) as Res), receiver__];
        } else {
          return;
        }
      } else {
        return;
      }
      break;
    }
    default:
      return;
  }

  if (method_did === undefined) {
    return;
  }

  if (receiver.kind.$ !== "Path") return;
  const qpath = receiver.kind._0;
  const res = typeck.qpath_res(qpath, receiver.hir_id);
  if (!(res.$ === "Def" && (res._0.$ === "Const" || res._0.$ === "AssocConst"))) return;
  const const_did = res._1;
  // Don't consider derefs as those can do arbitrary things
  // like using thread local (see rust-lang/rust#150157)
  if ((cx.typeck_results_() as TypeckResults).expr_adjustments(receiver).some((adj) => adj.kind.$ === "Deref")) return;
  // Let's do the attribute check after the other checks for perf reasons
  if (find_attr(HasAttrs_DefId.get_attrs(method_did, cx.tcx), (k) => (k.$ === "RustcShouldNotBeCalledOnConstItems" ? null : undefined)) === undefined) {
    return;
  }
  const method_name = cx.tcx.opt_item_ident(method_did);
  if (method_name === undefined) return;
  const const_name = cx.tcx.opt_item_ident(const_did);
  if (const_name === undefined) return;
  const const_ty = typeck.node_type_opt(receiver.hir_id);
  if (const_ty === undefined) return;

  // Find the local `const`-item and create the suggestion to use `static` instead
  let sugg_static: ConstItemInteriorMutationsSuggestionStatic | undefined;
  const node = cx.tcx.hir_get_if_local(const_did);
  if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Const") {
    const const_item = node._0;
    const ident = node._0.kind._0;
    const vis_span = Span.find_ancestor_inside(const_item.vis_span, const_item.span);
    if (vis_span !== undefined && Span.can_be_used_for_suggestions(const_item.span) && Span.can_be_used_for_suggestions(vis_span)) {
      sugg_static = {
        $: "Spanful",
        const_: Span.between(const_item.vis_span, ident.span),
        before: !Span.is_empty(vis_span) ? " " : "",
        const_name,
      };
    } else {
      sugg_static = { $: "Spanless", const_name };
    }
  } else {
    sugg_static = undefined;
  }

  cx.emit_span_lint(
    CONST_ITEM_INTERIOR_MUTATIONS,
    expr.span,
    ConstItemInteriorMutationsDiag_diagnostic({
      method_name,
      const_name,
      const_ty,
      receiver_span: receiver.span,
      sugg_static,
    }),
  );
};
