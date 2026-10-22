// Port of compiler/rustc_lint/src/shadowed_into_iter.rs. The lint statics and the `impl_lint_pass!` expansion are
// generated (shadowed_into_iter.lints.gen.ts).
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Span } from "../rustc_span/lib.ts";
import type { LateContext } from "./context.ts";
import { ShadowedIntoIterDiag_diagnostic, type ShadowedIntoIterDiagSub } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { ARRAY_INTO_ITER, BOXED_SLICE_INTO_ITER, ShadowedIntoIter_impl_lint_pass } from "./shadowed_into_iter.lints.gen.ts";

export * from "./shadowed_into_iter.lints.gen.ts";

// #[derive(Copy, Clone)]
// rustc-type: compiler/rustc_lint/src/shadowed_into_iter.rs:66 ShadowedIntoIter
export class ShadowedIntoIter implements LintPass, LateLintPass {
  // impl_lint_pass!(ShadowedIntoIter => [ARRAY_INTO_ITER, BOXED_SLICE_INTO_ITER]);
  name(): string {
    return ShadowedIntoIter_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ShadowedIntoIter_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ShadowedIntoIter_impl_lint_pass.lint_vec();
  }
  declare check_expr: (cx: LateContext, expr: hir.Expr) => void;
}

// impl<'tcx> LateLintPass<'tcx> for ShadowedIntoIter
// rustc: compiler/rustc_lint/src/shadowed_into_iter.rs:71 check_expr
ShadowedIntoIter.prototype.check_expr = function (this: ShadowedIntoIter, cx: LateContext, expr: hir.Expr): void {
  if (expr.kind.$ !== "MethodCall") {
    return;
  }
  const { _0: call, _1: receiver_arg } = expr.kind;

  // PORT: `LateContext::typeck_results` is typed `unknown` in context.ts (lane lint-late-a types it).
  const typeck_results = (): TypeckResults => cx.typeck_results_() as TypeckResults;

  // Check if the method call actually calls the libcore
  // `IntoIterator::into_iter`.
  const method_def_id = typeck_results().type_dependent_def_id(expr.hir_id);
  if (method_def_id === undefined) {
    return;
  }
  if (!cx.tcx.is_lang_item(method_def_id, LangItem.IntoIterIntoIter)) {
    return;
  }

  // As this is a method call expression, we have at least one argument.
  const receiver_ty = typeck_results().expr_ty(receiver_arg);
  const adjustments = typeck_results().expr_adjustments(receiver_arg);

  const adjusted_receiver_tys: Ty[] = [receiver_ty, ...adjustments.map((adj) => adj.target)];

  // rustc: compiler/rustc_lint/src/shadowed_into_iter.rs:92 is_ref_to_array
  function is_ref_to_array(ty: Ty): boolean {
    const k = ty.kind();
    if (k.$ === "Ref") {
      return k._1.is_array();
    } else {
      return false;
    }
  }
  // rustc: compiler/rustc_lint/src/shadowed_into_iter.rs:95 is_ref_to_boxed_slice
  function is_ref_to_boxed_slice(ty: Ty): boolean {
    const k = ty.kind();
    if (k.$ === "Ref") {
      const b = k._1.boxed_ty();
      return b !== undefined && b.is_slice();
    } else {
      return false;
    }
  }
  /** `tys.iter().copied().take_while(|ty| !stop(*ty)).position(|ty| pred(ty))` */
  const position_before = (stop: (ty: Ty) => boolean, pred: (ty: Ty) => boolean): number | undefined => {
    for (let i = 0; i < adjusted_receiver_tys.length; i++) {
      const ty = adjusted_receiver_tys[i]!;
      if (stop(ty)) return undefined;
      if (pred(ty)) return i;
    }
    return undefined;
  };

  let lint;
  let target: string;
  let edition: string;
  let can_suggest_ufcs: boolean;
  let idx: number | undefined;
  const last = adjusted_receiver_tys[adjusted_receiver_tys.length - 1]!;
  if (is_ref_to_array(last) && (idx = position_before(is_ref_to_array, (ty) => ty.is_array())) !== undefined) {
    [lint, target, edition, can_suggest_ufcs] = [ARRAY_INTO_ITER, "[T; N]", "2021", idx === 0];
  } else if (
    is_ref_to_boxed_slice(last) &&
    (idx = position_before(is_ref_to_boxed_slice, (ty) => {
      const b = ty.boxed_ty();
      return b !== undefined && b.is_slice();
    })) !== undefined
  ) {
    [lint, target, edition, can_suggest_ufcs] = [BOXED_SLICE_INTO_ITER, "Box<[T]>", "2024", idx === 0];
  } else {
    return;
  }

  // This check needs to avoid ICE from when `receiver_arg` is from macro expansion
  // Which leads to empty span in span arithmetic below
  // cc: https://github.com/rust-lang/rust/issues/147408
  const span = Span.find_ancestor_in_same_ctxt(receiver_arg.span, expr.span);

  // If this expression comes from the `IntoIter::into_iter` inside of a for loop,
  // we should just suggest removing the `.into_iter()` or changing it to `.iter()`
  // to disambiguate if we want to iterate by-value or by-ref.
  // PORT: `cx.tcx.hir_parent_iter(expr.hir_id).nth(1)`.
  let parent: hir.Node | undefined;
  {
    let n = 0;
    for (const [, node] of cx.tcx.hir_parent_iter(expr.hir_id)) {
      if (n++ === 1) {
        parent = node;
        break;
      }
    }
  }
  let sub: ShadowedIntoIterDiagSub | undefined;
  if (
    parent !== undefined &&
    parent.$ === "Expr" &&
    parent._0.kind.$ === "Match" &&
    parent._0.kind._1.length === 1 &&
    parent._0.kind._2.$ === "ForLoopDesugar" &&
    parent._0.kind._0.kind.$ === "Call" &&
    parent._0.kind._0.kind._1.length === 1 &&
    parent._0.kind._0.kind._0.kind.$ === "Path" &&
    cx.tcx.qpath_is_lang_item(parent._0.kind._0.kind._0.kind._0, LangItem.IntoIterIntoIter) &&
    span !== undefined
  ) {
    sub = {
      $: "RemoveIntoIter",
      span: Span.to(Span.shrink_to_hi(span), Span.shrink_to_hi(expr.span)),
    };
  } else if (can_suggest_ufcs && span !== undefined) {
    sub = {
      $: "UseExplicitIntoIter",
      start_span: Span.shrink_to_lo(expr.span),
      end_span: Span.to(Span.shrink_to_hi(span), Span.shrink_to_hi(expr.span)),
    };
  } else {
    sub = undefined;
  }

  cx.emit_span_lint(lint, call.ident.span, ShadowedIntoIterDiag_diagnostic({ target, edition, suggestion: call.ident.span, sub }));
};
