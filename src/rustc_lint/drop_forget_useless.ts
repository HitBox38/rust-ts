// Port of compiler/rustc_lint/src/drop_forget_useless.rs. The lint statics and the `declare_lint_pass!` expansion
// are generated (drop_forget_useless.lints.gen.ts).
// PORT: `cx.typeck_results()` is `cx.typeck_results_()` (the field `typeck_results` takes the name) and
// `LateContext::qpath_res` returns `unknown` until context.rs's `LateContext` is ported: both are cast here.
import { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { HirId_eq } from "../rustc_hir_id/lib.ts";
import type { TyKind } from "../rustc_middle/ty/sty.gen.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import type { LateContext } from "./context.ts";
import {
  DropCopyDiag_diagnostic,
  DropInPlaceCopyDiag_diagnostic,
  DropInPlaceRefDiag_diagnostic,
  DropRefDiag_diagnostic,
  ForgetCopyDiag_diagnostic,
  ForgetRefDiag_diagnostic,
  UndroppedManuallyDropsDiag_diagnostic,
  UndroppedManuallyDropsInPlaceDiag_diagnostic,
  UseLetUnderscoreIgnoreSuggestion,
} from "./diagnostics.gen.ts";
import {
  DROPPING_COPY_TYPES,
  DROPPING_REFERENCES,
  DropForgetUseless,
  FORGETTING_COPY_TYPES,
  FORGETTING_REFERENCES,
  UNDROPPED_MANUALLY_DROPS,
} from "./drop_forget_useless.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { std_or_core } from "./utils.ts";

export * from "./drop_forget_useless.lints.gen.ts";

declare module "./drop_forget_useless.lints.gen.ts" {
  interface DropForgetUseless extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for DropForgetUseless
// rustc: compiler/rustc_lint/src/drop_forget_useless.rs:145 check_expr
DropForgetUseless.prototype.check_expr = function (this: DropForgetUseless, cx: LateContext, expr: hir.Expr): void {
  let fn_did: DefId | undefined;
  let arg: hir.Expr;
  const k = expr.kind;
  // matching on `function(<receiver>, ...)`
  if (k.$ === "Call" && k._1.length === 1 && k._0.kind.$ === "Path") {
    const path = k._0;
    const qpath = k._0.kind._0;
    fn_did = Res.opt_def_id(cx.qpath_res(qpath, path.hir_id) as Res);
    arg = k._1[0]!;
  }
  // matching on `<receiver>.method(..)`
  else if (k.$ === "MethodCall") {
    fn_did = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id);
    arg = k._1;
  } else {
    return;
  }

  let fn_name;
  if (fn_did !== undefined && (fn_name = cx.tcx.get_diagnostic_name(fn_did)) !== undefined) {
    const arg_ty = (cx.typeck_results_() as TypeckResults).expr_ty(arg);
    const is_copy = cx.type_is_copy_modulo_regions(arg_ty);
    const drop_is_single_call_in_arm = is_single_call_in_arm(cx, arg, expr);

    const let_underscore_ignore_sugg = (): UseLetUnderscoreIgnoreSuggestion => {
      let first: [unknown, hir.Node] | undefined;
      for (const x of cx.tcx.hir_parent_iter(expr.hir_id)) {
        first = x;
        break;
      }
      let arg_span: Span | undefined;
      if (
        first !== undefined &&
        first[1].$ === "Stmt" &&
        first[1]._0.kind.$ === "Semi" &&
        HirId_eq(first[1]._0.kind._0.hir_id, expr.hir_id) &&
        (arg_span = Span.find_ancestor_inside_same_ctxt(arg.span, expr.span)) !== undefined
      ) {
        return {
          $: "Suggestion",
          start_span: Span.until(Span.shrink_to_lo(expr.span), arg_span),
          end_span: Span.until(Span.shrink_to_hi(arg_span), Span.shrink_to_hi(expr.span)),
        };
      } else {
        return UseLetUnderscoreIgnoreSuggestion.Note;
      }
    };

    const kind = arg_ty.kind();
    let krate: string | undefined;
    let inner_kind: TyKind;
    if (fn_name === sym.mem_drop && arg_ty.is_ref() && !drop_is_single_call_in_arm) {
      cx.emit_span_lint(
        DROPPING_REFERENCES,
        expr.span,
        DropRefDiag_diagnostic({ arg_ty, label: arg.span, sugg: let_underscore_ignore_sugg() }),
      );
    } else if (
      (fn_name === sym.ptr_drop_in_place || fn_name === sym.ptr_drop_in_place_self) &&
      kind.$ === "RawPtr" &&
      kind._0.is_ref() &&
      !drop_is_single_call_in_arm
    ) {
      cx.emit_span_lint(
        DROPPING_REFERENCES,
        expr.span,
        DropInPlaceRefDiag_diagnostic({
          arg_ty,
          label: arg.span,
          sugg: let_underscore_ignore_sugg(),
          from_fn: fn_name === sym.ptr_drop_in_place,
        }),
      );
    } else if (fn_name === sym.mem_forget && arg_ty.is_ref()) {
      cx.emit_span_lint(
        FORGETTING_REFERENCES,
        expr.span,
        ForgetRefDiag_diagnostic({
          arg_ty,
          label: arg.span,
          sugg: let_underscore_ignore_sugg(),
        }),
      );
    } else if (fn_name === sym.mem_drop && is_copy && !drop_is_single_call_in_arm) {
      cx.emit_span_lint(
        DROPPING_COPY_TYPES,
        expr.span,
        DropCopyDiag_diagnostic({
          arg_ty,
          label: arg.span,
          sugg: let_underscore_ignore_sugg(),
        }),
      );
    } else if (
      (fn_name === sym.ptr_drop_in_place || fn_name === sym.ptr_drop_in_place_self) &&
      kind.$ === "RawPtr" &&
      cx.type_is_copy_modulo_regions(kind._0) &&
      !drop_is_single_call_in_arm
    ) {
      cx.emit_span_lint(
        DROPPING_COPY_TYPES,
        expr.span,
        DropInPlaceCopyDiag_diagnostic({
          arg_ty,
          label: arg.span,
          sugg: let_underscore_ignore_sugg(),
          from_fn: fn_name === sym.ptr_drop_in_place,
        }),
      );
    } else if (fn_name === sym.mem_forget && is_copy) {
      cx.emit_span_lint(
        FORGETTING_COPY_TYPES,
        expr.span,
        ForgetCopyDiag_diagnostic({
          arg_ty,
          label: arg.span,
          sugg: let_underscore_ignore_sugg(),
        }),
      );
    } else if (
      fn_name === sym.mem_drop &&
      kind.$ === "Adt" &&
      kind._0.is_manually_drop() &&
      (krate = std_or_core(cx)) !== undefined
    ) {
      cx.emit_span_lint(
        UNDROPPED_MANUALLY_DROPS,
        expr.span,
        UndroppedManuallyDropsDiag_diagnostic({
          krate,
          arg_ty,
          label: arg.span,
          suggestion: {
            krate,
            start_span: Span.shrink_to_lo(arg.span),
            end_span: Span.shrink_to_hi(arg.span),
          },
        }),
      );
    } else if (
      (fn_name === sym.ptr_drop_in_place || fn_name === sym.ptr_drop_in_place_self) &&
      kind.$ === "RawPtr" &&
      (inner_kind = kind._0.kind()).$ === "Adt" &&
      inner_kind._0.is_manually_drop() &&
      (krate = std_or_core(cx)) !== undefined
    ) {
      cx.emit_span_lint(
        UNDROPPED_MANUALLY_DROPS,
        expr.span,
        UndroppedManuallyDropsInPlaceDiag_diagnostic({
          krate,
          arg_ty,
          label: arg.span,
          suggestion: {
            krate,
            start_span: Span.until(Span.shrink_to_lo(expr.span), Span.shrink_to_lo(arg.span)),
            end_span: Span.until(Span.shrink_to_hi(arg.span), Span.shrink_to_hi(expr.span)),
          },
        }),
      );
    } else {
      return;
    }
  }
};

// Dropping returned value of a function, as in the following snippet is considered idiomatic, see
// rust-lang/rust-clippy#9482 for examples.
//
// ```
// match <var> {
//     <pat> => drop(fn_with_side_effect_and_returning_some_value()),
//     ..
// }
// ```
// rustc: compiler/rustc_lint/src/drop_forget_useless.rs:310 is_single_call_in_arm
function is_single_call_in_arm(cx: LateContext, arg: hir.Expr, drop_expr: hir.Expr): boolean {
  if (arg.can_have_side_effects()) {
    const node = cx.tcx.parent_hir_node(drop_expr.hir_id);
    if (node.$ === "Arm") {
      return HirId_eq(node._0.body.hir_id, drop_expr.hir_id);
    }
  }
  return false;
}
